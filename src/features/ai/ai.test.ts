import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import { importCompany } from "../companies/company.service";
import { enrichCompany } from "../enrichment/enrichment.service";
import { extractWebsiteFacts } from "../enrichment/website.facts";
import { analyzeCompany, generateAiOutreach } from "./ai.service";
import { validateAnalysis } from "./ai.validation";

const good = {
  summary: "s", main_problem: "p", opportunity: "o",
  recommended_offer: "r", outreach_angle: "a", confidence: 0.7,
};

describe("validation", () => {
  it("rejects malformed analysis", () => {
    expect(() => validateAnalysis(null)).toThrow();
    expect(() => validateAnalysis({ ...good, summary: "" })).toThrow();
    expect(() => validateAnalysis({ ...good, confidence: 2 })).toThrow();
    expect(validateAnalysis(good).confidence).toBe(0.7);
  });
});

describe("ai service", () => {
  let id: number;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    id = (await importCompany({ name: "Clínica", city: "Cuiabá", website: "http://c.com" }, "MANUAL")).id;
    await enrichCompany(id, async (u) =>
      extractWebsiteFacts("<html><body>oi</body></html>", { url: u, finalUrl: u, httpStatus: 200 }),
    );
  });

  it("stores validated analysis and sends facts, not raw html", async () => {
    const chat = vi.fn().mockResolvedValue({ json: good, model: "m" });
    const a = await analyzeCompany(id, chat);
    expect(a.model).toBe("m");
    const prompt = chat.mock.calls[0][0][1].content as string;
    expect(prompt).toContain("NO_HTTPS");
    expect(prompt).not.toContain("<html");
  });

  it("rejects outreach citing a signal that does not exist", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ json: good, model: "m" })
      .mockResolvedValueOnce({ json: { message: "Oi", evidence_used: ["NO_FORM", "NOT_A_SIGNAL"] }, model: "m" });
    await expect(generateAiOutreach(id, "FIRST_CONTACT", chat)).rejects.toThrow(/inexistente/);
  });

  it("accepts outreach with real evidence", async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ json: good, model: "m" })
      .mockResolvedValueOnce({ json: { message: "Oi", evidence_used: ["NO_FORM"] }, model: "m" });
    const r = await generateAiOutreach(id, "FIRST_CONTACT", chat);
    expect(r.evidence_used).toEqual(["NO_FORM"]);
  });
});

import { ensureServicesSeed } from "../services/services.service";
import { validatePlan } from "./ai.validation";

describe("ai plan (services + approaches in ONE call)", () => {
  it("keeps valid items and drops unknown services, channels and fake evidence", () => {
    const plan = validatePlan(
      {
        ...good,
        recommended_services: [
          { service_key: "SISTEMA_AUTOMACAO", reason: "agenda manual", pitch: "automatizar" },
          { service_key: "INVENTADO", reason: "x", pitch: "y" },
        ],
        approaches: [
          { channel: "WHATSAPP", service_key: "SISTEMA_AUTOMACAO", angle: "a", message: "Oi", evidence_used: ["NO_FORM"] },
          { channel: "TELEGRAM", service_key: null, angle: "a", message: "Oi", evidence_used: [] },
          { channel: "WHATSAPP", service_key: null, angle: "a", message: "Oi", evidence_used: ["SINAL_FALSO"] },
        ],
      },
      { serviceKeys: ["SISTEMA_AUTOMACAO"], channels: ["WHATSAPP"], signalTypes: ["NO_FORM"] },
    );
    expect(plan.services).toHaveLength(1);
    expect(plan.approaches).toHaveLength(1);
    expect(plan.dropped).toBe(3);
  });

  it("saves analysis + AI approaches with a single model call and replaces older AI ones", async () => {
    db = await createMigratedTestDb();
    await ensureServicesSeed();
    const id = (await importCompany({ name: "Clínica", city: "Cuiabá", website: "http://c.com", phone: "(65) 98888-7777" }, "MANUAL")).id;
    await enrichCompany(id, async (u) =>
      extractWebsiteFacts("<html><body>oi</body></html>", { url: u, finalUrl: u, httpStatus: 200 }),
    );

    const chat = vi.fn().mockResolvedValue({
      json: {
        ...good,
        recommended_services: [{ service_key: "LANDING_PAGE", reason: "sem CTA", pitch: "página de conversão" }],
        approaches: [{ channel: "WHATSAPP", service_key: "LANDING_PAGE", angle: "conversão", message: "Olá!", evidence_used: ["NO_CLEAR_CTA"] }],
      },
      model: "m",
    });

    const a = await analyzeCompany(id, chat);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(JSON.parse(a.recommended_services!)[0].service_key).toBe("LANDING_PAGE");
    expect(chat.mock.calls[0][0][1].content).toContain("SISTEMA_AUTOMACAO"); // catálogo enviado

    await analyzeCompany(id, chat);
    const ai = await db.select("SELECT id FROM company_approaches WHERE company_id=$1 AND source='AI'", [id]);
    expect(ai).toHaveLength(1);
    const tpl = await db.select("SELECT id FROM company_approaches WHERE company_id=$1 AND source='TEMPLATE'", [id]);
    expect(tpl.length).toBeGreaterThan(0);
  });
});
