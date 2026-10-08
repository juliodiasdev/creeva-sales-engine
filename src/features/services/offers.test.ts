import { describe, expect, it } from "vitest";

import { matchServices } from "./offers.engine";
import { buildTemplateApproaches } from "../contacts/approaches.engine";

const base = { segment: "Odontologia", website: null, reviews_count: null, rating: null, company_size: null, capital: null };

describe("matchServices", () => {
  it("no website -> site/loja first, with evidence-based reasons", () => {
    const m = matchServices({
      company: base,
      signals: [{ type: "NO_WEBSITE", evidence: "Nenhum website cadastrado." }],
      facts: null,
    });
    expect(m[0].key).toBe("SITE_LOJA");
    expect(m[0].signals).toContain("NO_WEBSITE");
    expect(m[0].reasons.join(" ")).toContain("Sem site");
  });

  it("weak conversion with tracking -> landing page", () => {
    const m = matchServices({
      company: { ...base, website: "https://x.com" },
      signals: [
        { type: "WEAK_CONVERSION_PATH", evidence: "Sem CTA." },
        { type: "NO_FORM", evidence: "Sem formulário." },
      ],
      facts: { technologies: ["Meta Pixel"], error: null } as never,
    });
    expect(m[0].key).toBe("LANDING_PAGE");
  });

  it("volume + schedule segment -> systems/automation; big company -> software", () => {
    const m = matchServices({
      company: { ...base, reviews_count: 350, capital: 900000, company_size: "DEMAIS" },
      signals: [],
      facts: null,
    });
    const keys = m.map((x) => x.key);
    expect(keys).toContain("SISTEMA_AUTOMACAO");
    expect(keys).toContain("SOFTWARE_APP");
  });

  it("returns nothing without evidence and respects inactive services", () => {
    expect(matchServices({ company: { ...base, segment: "Padaria" }, signals: [], facts: null })).toEqual([]);
    const m = matchServices({
      company: base,
      signals: [{ type: "NO_WEBSITE", evidence: "x" }],
      facts: null,
      activeKeys: ["LANDING_PAGE"],
    });
    expect(m.map((x) => x.key)).toEqual(["LANDING_PAGE"]);
  });
});

describe("template approaches", () => {
  const matches = matchServices({
    company: base,
    signals: [{ type: "NO_WEBSITE", evidence: "Nenhum website cadastrado." }],
    facts: null,
  });

  it("one approach per available channel; cites only real evidence", () => {
    const a = buildTemplateApproaches({
      companyName: "Clínica Sorriso", segment: "Odontologia", matches,
      availableChannels: ["WHATSAPP", "EMAIL", "WEBSITE"], agency: "Creava Digital", seller: "Júlio",
    });
    expect(a.map((x) => x.channel)).toEqual(["WHATSAPP", "EMAIL"]);
    expect(a[0].message).toContain("não encontrei um site");
    expect(a[0].evidence_used).toEqual(["NO_WEBSITE"]);
    expect(a[0].service_key).toBe("SITE_LOJA");
  });

  it("without evidence the message is neutral (no false claims)", () => {
    const a = buildTemplateApproaches({
      companyName: "Padaria", segment: null, matches: [],
      availableChannels: ["WHATSAPP", "PHONE"], agency: "Creava Digital", seller: "",
    });
    expect(a[0].message).not.toMatch(/site|HTTPS|WhatsApp no site/i);
    expect(a[0].evidence_used).toEqual([]);
    expect(a[1].message).toContain("Roteiro de ligação");
  });
});
