import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../lib/database";

let db: Db;

vi.mock("../../lib/database", () => ({
  getDatabase: async () => db,
}));
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import { importCompany } from "../companies/company.service";
import { createProspect } from "../prospects/prospect.service";
import { importPlaces } from "../discovery/discovery.service";
import { extractWebsiteFacts } from "./website.facts";
import { deriveSignals } from "../signals/signals.engine";
import { computeScore } from "../scoring/scoring.engine";
import { enrichCompany } from "./enrichment.service";
import { setSetting } from "../settings/settings.service";

const HTML_GOOD = `<html><head><title>Clínica</title>
<meta name="viewport" content="width=device-width">
<meta name="description" content="Odontologia"></head>
<body><h1>Sorria</h1>
<a href="https://wa.me/5565999991234">Fale pelo WhatsApp</a>
<a href="https://instagram.com/clinica">insta</a>
<form></form><footer>© 2019 Clínica</footer>
<script src="https://www.googletagmanager.com/gtag/js"></script></body></html>`;

const HTML_BAD = `<html><body><p>Bem-vindo</p></body></html>`;

describe("dedupe + discovery", () => {
  beforeEach(async () => {
    db = await createMigratedTestDb();
  });

  it("does not duplicate by place id, domain, phone or name+address", async () => {
    const places = [
      { id: "p1", displayName: { text: "Clínica A" }, formattedAddress: "Rua 1, 10", websiteUri: "https://www.a.com.br/", nationalPhoneNumber: "(65) 3333-1111" },
      { id: "p1", displayName: { text: "Clínica A" } },
      { id: "p2", displayName: { text: "Outra" }, websiteUri: "http://a.com.br/contato" },
      { id: "p3", displayName: { text: "Outra 2" }, nationalPhoneNumber: "+55 65 3333 1111" },
      { id: "p4", displayName: { text: "CLÍNICA  A" }, formattedAddress: "rua 1 10" },
      { id: "p5", displayName: { text: "Nova" }, formattedAddress: "Rua 9" },
    ];
    const r = await importPlaces(places, "Odontologia");
    expect(r).toEqual({ found: 6, imported: 2, duplicates: 4 });
    const src = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM company_sources");
    expect(src[0].n).toBe(2);
    const prospects = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM prospects");
    expect(prospects[0].n).toBe(0);
  });
});

describe("facts → signals → score", () => {
  it("extracts facts without inventing", () => {
    const f = extractWebsiteFacts(HTML_GOOD, { url: "https://a.com", httpStatus: 200 });
    expect(f.hasViewport).toBe(true);
    expect(f.whatsappLinks).toHaveLength(1);
    expect(f.copyrightYear).toBe(2019);
    expect(f.technologies).toContain("Google Analytics");
    expect(f.socialLinks.instagram).toBeTruthy();
    const bad = extractWebsiteFacts(HTML_BAD, { url: "http://b.com", finalUrl: "http://b.com" });
    expect(bad.https).toBe(false);
    expect(bad.ctas).toHaveLength(0);
  });

  it("emits signals only with evidence, none for website when no facts", () => {
    const none = deriveSignals({ website: "https://x.com", rating: null, reviews_count: null }, null, 2026);
    expect(none).toHaveLength(0);

    const bad = extractWebsiteFacts(HTML_BAD, { url: "http://b.com", finalUrl: "http://b.com" });
    const types = deriveSignals({ website: "http://b.com", rating: 4.8, reviews_count: 5 }, bad, 2026).map((s) => s.type);
    expect(types).toEqual(expect.arrayContaining(["NO_HTTPS", "NO_MOBILE_SIGNAL", "NO_WHATSAPP", "NO_CLEAR_CTA", "NO_FORM", "WEAK_CONVERSION_PATH", "LOW_REVIEWS"]));

    const noSite = deriveSignals({ website: null, rating: null, reviews_count: null }, null);
    expect(noSite.map((s) => s.type)).toEqual(["NO_WEBSITE"]);
  });

  it("score is bounded and explained", () => {
    const company = { name: "X", segment: "Odontologia", city: "Cuiabá", phone: "1", reviews_count: 150, rating: 4.7, website: null } as never;
    const s = computeScore({ company, signals: deriveSignals(company, null), facts: null, preferredSegments: ["odontologia"] });
    expect(s.total).toBeLessThanOrEqual(100);
    expect(s.need).toBe(25);
    expect(s.reasons.every((r) => r.reason.length > 0)).toBe(true);
    expect(s.reasons.reduce((a, r) => a + r.points, 0)).toBeGreaterThanOrEqual(s.total);
  });
});

describe("enrichment pipeline", () => {
  beforeEach(async () => {
    db = await createMigratedTestDb();
  });

  it("qualifies a weak-site company, stores snapshot/signals/score, syncs prospect", async () => {
    await setSetting("min_score", "30");
    const { id } = await importCompany(
      { name: "Clínica B", segment: "Odontologia", city: "Cuiabá", website: "http://b.com", phone: "(65) 3333-2222", reviews_count: 80, rating: 4.5 } as never,
      "MANUAL",
    );
    const crawler = async (u: string) => extractWebsiteFacts(HTML_BAD, { url: u, finalUrl: u, httpStatus: 200 });
    const out = await enrichCompany(id, crawler);
    expect(out.status).toBe("QUALIFIED");

    const [{ n: sig }] = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM signals WHERE company_id=$1", [id]);
    expect(sig).toBeGreaterThan(3);
    const [{ n: snap }] = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM website_snapshots");
    expect(snap).toBe(1);

    await createProspect(id);
    await enrichCompany(id, crawler);
    const [p] = await db.select<{ score: number }[]>("SELECT score FROM prospects");
    expect(p.score).toBe(out.total);
    const [c] = await db.select<{ lead_status: string }[]>("SELECT lead_status FROM companies");
    expect(c.lead_status).toBe("READY");
  });

  it("inactive CNPJ => DISQUALIFIED with reason", async () => {
    const { id } = await importCompany({ name: "Baixada", city: "X" }, "MANUAL");
    await db.execute("UPDATE companies SET registration_status='BAIXADA' WHERE id=$1", [id]);
    const out = await enrichCompany(id);
    expect(out.status).toBe("DISQUALIFIED");
    const [c] = await db.select<{ disqualified_reason: string }[]>("SELECT * FROM companies");
    expect(c.disqualified_reason).toContain("BAIXADA");
  });
});
