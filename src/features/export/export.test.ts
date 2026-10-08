import { describe, expect, it } from "vitest";

import { buildContactRows, toCsv } from "./export.service";

const company = (id: number, name: string, extra = {}) => ({
  id, name, segment: "Odontologia", city: "Cuiabá", state: "MT", address: "Rua A, 1",
  rating: 4.8, reviews_count: 120, lead_status: "QUALIFIED", created_at: "2026-10-08T10:00:00Z", ...extra,
}) as never;

describe("contact export", () => {
  const rows = buildContactRows({
    companies: [company(1, "Clínica A"), company(1, "Clínica A (repetida)"), company(2, '=HYPERLINK("x")')],
    channels: [
      { id: 1, company_id: 1, kind: "WHATSAPP", value: "65988887777", url: null, label: null, source: "WEBSITE" },
      { id: 2, company_id: 1, kind: "INSTAGRAM", value: "a", url: "https://www.instagram.com/a/", label: null, source: "WEBSITE" },
      { id: 3, company_id: 1, kind: "PHONE", value: "6533331111", url: null, label: null, source: "GOOGLE_PLACES" },
    ] as never,
    approaches: [
      { id: 1, company_id: 1, channel: "WHATSAPP", service_key: "LANDING_PAGE", angle: "x", message: "Template", evidence_used: null, source: "TEMPLATE", created_at: "" },
      { id: 2, company_id: 1, channel: "WHATSAPP", service_key: "SISTEMA_AUTOMACAO", angle: "x", message: "Mensagem IA", evidence_used: null, source: "AI", created_at: "" },
    ] as never,
    scores: new Map([[1, 82]]),
    prospectStatus: new Map([[1, "CONTACTED"]]),
    sources: new Map([[1, "GOOGLE_PLACES"]]),
    serviceNames: new Map([["SISTEMA_AUTOMACAO", "Sistemas e automações"]]),
  });

  it("one row per company (no duplicates), formatted contacts, AI approach preferred", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      empresa: "Clínica A", whatsapp: "(65) 98888-7777", telefone: "(65) 3333-1111",
      instagram: "https://www.instagram.com/a/", score: 82, status_prospect: "CONTACTED",
      servico_sugerido: "Sistemas e automações", abordagem_whatsapp: "Mensagem IA", fonte: "Google Places",
      cadastrado_em: "2026-10-08",
    });
    expect(rows[1].whatsapp).toBe("");
  });

  it("csv: BOM, ';' separator, quoting and formula-injection protection", () => {
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿Empresa;Segmento")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/;=HYPERLINK/);
  });
});
