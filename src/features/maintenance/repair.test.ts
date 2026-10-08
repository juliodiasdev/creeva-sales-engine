import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});

import { importCompany } from "../companies/company.service";
import { buildChannels } from "../contacts/channels.engine";
import { deriveSignals } from "../signals/signals.engine";
import { isGenericHost, normalizeEmail, siteDomain, socialProfile } from "../../lib/normalize";
import { runRepairsOnce } from "./repair.service";

describe("real-world data quality", () => {
  it("platform links are not websites and never act as dedupe domain", () => {
    expect(isGenericHost("https://www.instagram.com/dramarianalimap")).toBe(true);
    expect(isGenericHost("https://pt-br.facebook.com/x")).toBe(true);
    expect(isGenericHost("https://wa.me/message/ABC")).toBe(true);
    expect(isGenericHost("https://www.clinicaalfa.com.br/")).toBe(false);
    expect(isGenericHost("https://dra-paula.vercel.app/")).toBe(false);
    expect(siteDomain("https://instagram.com/x")).toBeNull();
    expect(siteDomain("https://www.clinicaalfa.com.br/x")).toBe("clinicaalfa.com.br");
  });

  it("filters platform handles and internal emails seen in the real sheet", () => {
    for (const bad of ["https://www.instagram.com/blog/", "https://www.instagram.com/whatsapp/", "https://www.instagram.com/wix/", "https://www.facebook.com/docs", "https://www.facebook.com/wixportugues"]) {
      expect(socialProfile(bad), bad).toBeNull();
    }
    expect(socialProfile("https://www.instagram.com/imo.cuiaba/")?.handle).toBe("imo.cuiaba");
    expect(normalizeEmail("605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com")).toBeNull();
    expect(normalizeEmail("comercial@odontoalfamt.com.br")).toBe("comercial@odontoalfamt.com.br");
  });

  it("a social profile registered as 'site' becomes a social channel and counts as NO_WEBSITE", () => {
    const company = { website: "https://www.instagram.com/dramarianalimap", phone: "(65) 99290-9857", instagram: null };
    const channels = buildChannels(company, null);
    expect(channels.find((c) => c.kind === "INSTAGRAM")?.value).toBe("dramarianalimap");
    expect(channels.find((c) => c.kind === "WEBSITE")).toBeUndefined();

    const signals = deriveSignals({ website: company.website, rating: null, reviews_count: null }, null);
    expect(signals.map((s) => s.type)).toContain("NO_WEBSITE");
    expect(signals[0].evidence).toContain("perfil/link de terceiros");
  });

  it("wa.me/message links become a click-to-chat channel", () => {
    const channels = buildChannels({ website: "https://wa.me/message/FB2KVATU7UPFH1", phone: null, instagram: null }, null);
    expect(channels).toEqual([expect.objectContaining({ kind: "WHATSAPP", value: "msg/FB2KVATU7UPFH1", url: "https://wa.me/message/FB2KVATU7UPFH1" })]);
  });

  it("two different companies with Instagram as website are NOT duplicates", async () => {
    db = await createMigratedTestDb();
    const a = await importCompany({ name: "Dra Ana", city: "Cuiabá", website: "https://instagram.com/draana" }, "MANUAL");
    const b = await importCompany({ name: "Dr Bruno", city: "Cuiabá", website: "https://instagram.com/drbruno" }, "MANUAL");
    expect(a.created && b.created).toBe(true);
    expect((await db.select<{ domain: string | null }[]>("SELECT domain FROM companies")).every((r) => r.domain === null)).toBe(true);
  });
});

describe("legacy repair (runs once)", () => {
  beforeEach(async () => {
    db = await createMigratedTestDb();
  });

  it("clears generic domains, releases wrongly-blocked places and removes junk channels", async () => {
    await db.execute(`INSERT INTO companies (id,name,google_place_id,domain,dedupe_key) VALUES (1,'A','gp-A','instagram.com','a|x')`);
    await db.execute(`INSERT INTO companies (id,name,google_place_id,domain,dedupe_key) VALUES (2,'B','gp-B','b.com.br','b|x')`);
    // gp-C foi bloqueado por engano (apontava para a empresa A por causa do domínio)
    await db.execute(`INSERT INTO seen_places (google_place_id,company_id) VALUES ('gp-A',1),('gp-C',1),('gp-B',2)`);
    for (const [kind, value, url] of [
      ["INSTAGRAM", "blog", "https://www.instagram.com/blog/"],
      ["INSTAGRAM", "imo.cuiaba", "https://www.instagram.com/imo.cuiaba/"],
      ["FACEBOOK", "docs", "https://www.facebook.com/docs"],
      ["EMAIL", "605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com", null],
      ["EMAIL", "ok@b.com.br", null],
      ["WEBSITE", "instagram.com", "https://instagram.com/x"],
    ]) await db.execute(`INSERT INTO company_channels (company_id,kind,value,url,source) VALUES (2,$1,$2,$3,'WEBSITE')`, [kind, value, url]);

    const report = await runRepairsOnce();
    expect(report).toEqual({ domainsCleared: 1, ledgerReleased: 1, junkChannelsRemoved: 4 });

    const places = (await db.select<{ google_place_id: string }[]>(`SELECT google_place_id FROM seen_places ORDER BY 1`)).map((r) => r.google_place_id);
    expect(places).toEqual(["gp-A", "gp-B"]); // gp-C liberado para nova busca
    const kept = (await db.select<{ value: string }[]>(`SELECT value FROM company_channels ORDER BY value`)).map((r) => r.value);
    expect(kept).toEqual(["imo.cuiaba", "ok@b.com.br"]);
    expect(await runRepairsOnce()).toBeNull(); // só uma vez
  });
});
