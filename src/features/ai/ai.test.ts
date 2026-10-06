import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../lib/database";

let db: Db;

vi.mock("../../lib/database", () => ({ getDatabase: async () => db }));
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
