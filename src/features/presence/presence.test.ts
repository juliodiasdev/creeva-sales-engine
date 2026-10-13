import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import type { Company } from "../companies/company.types";
import { importCompany } from "../companies/company.service";
import { enrichCompany } from "../enrichment/enrichment.service";
import { extractWebsiteFacts, failedWebsiteFacts } from "../enrichment/website.facts";
import type { WebsiteFacts } from "../enrichment/website.facts";
import { ensureServicesSeed } from "../services/services.service";
import { assessPresence } from "./presence.engine";
import { assessAndSavePresence, getPresence, listPresenceSummaries } from "./presence.service";

const NOW = new Date("2026-10-13T12:00:00Z");

const company = (over: Partial<Company> = {}): Company =>
  ({
    id: 1, name: "Clínica Sorriso", segment: "Odontologia", category: "Dentista", city: "Cuiabá", state: "MT",
    website: null, phone: "(65) 3333-1111", address: "Av. Brasil, 100", rating: 4.8, reviews_count: 120,
    instagram: null, domain: null, ...over,
  }) as Company;

const GOOD_HTML = `<html><head><title>Clínica Sorriso</title><meta name="description" content="Dentista em Cuiabá">
<meta name="viewport" content="width=device-width"><script src="https://www.googletagmanager.com/gtag/js"></script></head>
<body><a href="https://wa.me/5565992250342">Fale conosco</a><a href="https://instagram.com/clinicasorriso">ig</a>
<a href="/privacidade">Política de privacidade</a><form></form><button>Agendar consulta</button>
<p>Agende sua consulta online. © 2026 Clínica Sorriso</p><a href="mailto:contato@clinica.com.br">e</a></body></html>`;

const facts = (html: string, over: Partial<WebsiteFacts> = {}): WebsiteFacts => ({
  ...extractWebsiteFacts(html, { url: "https://clinicasorriso.com.br", finalUrl: "https://clinicasorriso.com.br/", httpStatus: 200 }),
  loadMs: 900,
  ...over,
});

const ch = (kind: string, value = "x", label: string | null = null) => ({ kind, value, label });

describe("assessPresence", () => {
  it("empresa sem site nem redes: sem presença digital, hora de vender o site", () => {
    const r = assessPresence({ company: company(), channels: [ch("PHONE", "6533331111")], facts: null, now: NOW });

    expect(r.level).toBe("NONE");
    expect(r.moment).toBe("READY");
    expect(r.position).toMatch(/Invisível/);
    expect(r.offers[0].service).toBe("SITE_LOJA");
    expect(r.offers[0].reasons[0]).toMatch(/Tem site próprio/);
    expect(r.gaps.map((g) => g.id)).toContain("site.exists");
  });

  it("com site cadastrado mas ainda não lido: faltam dados (não finge medir)", () => {
    const r = assessPresence({ company: company({ website: "https://clinicasorriso.com.br" }), channels: [ch("PHONE", "6533331111")], facts: null, now: NOW });

    expect(r.moment).toBe("NEEDS_DATA");
    expect(r.blockers[0]).toMatch(/ainda não foi lido/);
    expect(r.dimensions.find((d) => d.key === "SITE")!.checks.find((c) => c.id === "site.online")!.status).toBe("UNKNOWN");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("site que não abre: lacuna grave e orientação de conferir o endereço", () => {
    const r = assessPresence({
      company: company({ website: "https://clinicasorriso.com.br" }),
      channels: [],
      facts: failedWebsiteFacts("https://clinicasorriso.com.br", "ENOTFOUND"),
      now: NOW,
    });

    expect(r.gaps[0]).toMatchObject({ id: "site.online", status: "FAIL" });
    expect(r.blockers[0]).toMatch(/não abriu/);
    expect(r.moment).toBe("NEEDS_DATA");
  });

  it("site fraco (sem https, celular, botão, WhatsApp): presença básica e ofertas com motivos reais", () => {
    const weak = extractWebsiteFacts("<html><head><title>Clínica</title></head><body>© 2015 Clínica</body></html>", {
      url: "http://clinicasorriso.com.br", finalUrl: "http://clinicasorriso.com.br/", httpStatus: 200,
    });

    const r = assessPresence({
      company: company({ website: "http://clinicasorriso.com.br", rating: 3.5, reviews_count: 4 }),
      channels: [ch("PHONE", "6533331111")],
      facts: { ...weak, loadMs: 5200 },
      now: NOW,
    });

    const site = r.dimensions.find((d) => d.key === "SITE")!;
    const status = (id: string) => site.checks.find((c) => c.id === id)!.status;

    expect(["site.https", "site.mobile", "site.cta", "site.whatsapp", "site.speed", "site.fresh"].map(status)).toEqual([
      "FAIL", "FAIL", "FAIL", "FAIL", "FAIL", "FAIL",
    ]);
    expect(r.level).toBe("BASIC");
    expect(r.moment).toBe("READY");
    expect(r.offers.map((o) => o.service)).toContain("SITE_LOJA");
    expect(r.offers[0].reasons.join(" ")).toMatch(/HTTPS|celular/);
  });

  it("presença forte: avançada, com poucas brechas e oferta de automação", () => {
    const r = assessPresence({
      company: company({ website: "https://clinicasorriso.com.br" }),
      channels: [ch("PHONE", "6533331111"), ch("WHATSAPP", "65992250342", "confirmado no site"), ch("EMAIL", "contato@clinica.com.br"), ch("INSTAGRAM", "clinicasorriso"), ch("FACEBOOK", "clinicasorriso"), ch("LINKEDIN", "company/clinica")],
      facts: facts(GOOD_HTML),
      now: NOW,
    });

    expect(r.level).toBe("ADVANCED");
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.strengths.length).toBeGreaterThan(0);
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.position).toMatch(/Presença forte/);
  });

  it("WhatsApp só 'provável' é aviso, não OK; o que não dá para medir nunca derruba a nota", () => {
    const base = {
      company: company({ website: "https://clinicasorriso.com.br" }),
      facts: facts(GOOD_HTML, { copyrightYear: null, loadMs: null }),
      now: NOW,
    };

    const probable = assessPresence({ ...base, channels: [ch("WHATSAPP", "65992250342", "provável (celular)")] });
    const confirmed = assessPresence({ ...base, channels: [ch("WHATSAPP", "65992250342", "confirmado no site")] });
    const status = (r: ReturnType<typeof assessPresence>) =>
      r.dimensions.find((d) => d.key === "CONTACT")!.checks.find((c) => c.id === "contact.whatsapp")!.status;

    expect(status(probable)).toBe("WARN");
    expect(status(confirmed)).toBe("OK");
    expect(confirmed.score!).toBeGreaterThan(probable.score!);
    expect(confirmed.dimensions.find((d) => d.key === "SITE")!.checks.find((c) => c.id === "site.speed")!.status).toBe("UNKNOWN");
  });

  it("agendamento e loja virtual só são cobrados do segmento que precisa", () => {
    const html = "<html><head><title>A</title><meta name='viewport' content='x'></head><body>Olá</body></html>";
    const dentist = assessPresence({ company: company({ website: "https://a.com.br" }), channels: [], facts: facts(html), now: NOW });
    const store = assessPresence({ company: company({ website: "https://a.com.br", segment: "Loja de roupas", category: "Loja de roupas" }), channels: [], facts: facts(html), now: NOW });
    const ids = (r: ReturnType<typeof assessPresence>) => r.dimensions.flatMap((d) => d.checks).map((c) => c.id);

    expect(ids(dentist)).toContain("conv.booking");
    expect(ids(dentist)).not.toContain("conv.shop");
    expect(ids(store)).toContain("conv.shop");
  });

  it("site em construtor gratuito não conta como domínio próprio", () => {
    const r = assessPresence({ company: company({ website: "https://clinica.wixsite.com/site" }), channels: [], facts: facts(GOOD_HTML), now: NOW });

    expect(r.dimensions.find((d) => d.key === "SITE")!.checks.find((c) => c.id === "site.domain")!.status).toBe("FAIL");
  });
});

describe("presença salva no banco", () => {
  beforeEach(async () => {
    await createMigratedTestDb();
    await ensureServicesSeed();
  });

  it("o enriquecimento avalia e guarda; reavaliar não precisa ler o site de novo", async () => {
    const id = (await importCompany({ name: "Clínica Sorriso", city: "Cuiabá", website: "http://clinicasorriso.com.br", phone: "(65) 3333-1111" }, "GOOGLE_PLACES")).id;
    const crawler = vi.fn().mockResolvedValue(facts("<html><head><title>x</title></head><body>oi</body></html>", { https: false }));

    await enrichCompany(id, crawler);

    const saved = await getPresence(id);
    expect(saved).toMatchObject({ companyId: id, moment: "READY" });
    expect(saved!.report.gaps.length).toBeGreaterThan(0);

    crawler.mockClear();
    await assessAndSavePresence(id);
    expect(crawler).not.toHaveBeenCalled();

    const summaries = await listPresenceSummaries([id, 999]);
    expect(summaries.get(id)).toMatchObject({ level: saved!.level });
    expect(summaries.has(999)).toBe(false);
  });
});
