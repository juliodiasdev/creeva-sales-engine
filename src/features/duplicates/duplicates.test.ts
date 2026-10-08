import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});

import { createProspect } from "../prospects/prospect.service";
import { findDuplicateGroups, nameSimilarity } from "./duplicates.engine";
import type { CompanyBrief } from "./duplicates.engine";
import {
  confirmGroupWithAi,
  mergeCompanies,
  scanDuplicates,
  validateVerdict,
} from "./duplicates.service";

const brief = (id: number, name: string, city: string | null, extra: Partial<CompanyBrief> = {}): CompanyBrief => ({
  id, name, city, address: null, phone_normalized: null, domain: null, cnpj: null,
  google_place_id: null, website: null, phone: null, lead_status: "DISCOVERED", ...extra,
});

describe("engine", () => {
  it("similarity ignores accents, case and legal suffixes", () => {
    expect(nameSimilarity("Clínica Sorriso Ltda", "clinica sorriso")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Auto Center Prime", "Padaria Doce Pão")).toBeLessThan(0.4);
  });

  it("groups near-duplicates in the same city only", () => {
    const groups = findDuplicateGroups([
      brief(1, "Clínica Sorriso", "Cuiabá"),
      brief(2, "CLINICA SORRISO LTDA", "Cuiabá"),
      brief(3, "Clínica Sorriso", "Várzea Grande"),
      brief(4, "Academia Força", "Cuiabá"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual([1, 2]);
  });

  it("groups by strong keys even with different names", () => {
    const groups = findDuplicateGroups([
      brief(1, "Alfa", "A", { domain: "x.com.br" }),
      brief(2, "Beta Serviços", "B", { domain: "x.com.br" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons).toContain("mesmo site");
  });
});

describe("ai verdict", () => {
  it("rejects a master outside the group and bad confidence", () => {
    expect(() => validateVerdict({ same_entity: true, master_id: 99, confidence: 0.9 }, [1, 2])).toThrow(/fora do grupo/);
    expect(() => validateVerdict({ same_entity: true, master_id: 1, confidence: 3 }, [1, 2])).toThrow();
    expect(validateVerdict({ same_entity: true, master_id: 2, confidence: 0.9, reason: "ok" }, [1, 2]).master_id).toBe(2);
  });

  it("asks the model with plain records and validates the answer", async () => {
    const chat = vi.fn().mockResolvedValue({ json: { same_entity: true, master_id: 1, confidence: 0.95, reason: "mesmo endereço" }, model: "m" });
    const v = await confirmGroupWithAi({ members: [brief(1, "A", "X"), brief(2, "A", "X")], reasons: [] }, chat);
    expect(v.same_entity).toBe(true);
    expect(chat.mock.calls[0][0][1].content).toContain('"nome":"A"');
  });
});

describe("merge", () => {
  beforeEach(async () => {
    db = await createMigratedTestDb();
  });

  const insert = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await db.execute(
      `INSERT INTO companies (name, city, dedupe_key) VALUES ($1, 'Cuiabá', $2)`,
      [name, name.toLowerCase()],
    );
    const id = r.lastInsertId!;
    for (const [k, v] of Object.entries(extra)) {
      await db.execute(`UPDATE companies SET ${k} = $1 WHERE id = $2`, [v, id]);
    }
    return id;
  };

  it("keeps the master, fills gaps, moves sources and prospect", async () => {
    const master = await insert("Clínica Sorriso");
    const dup = await insert("Clinica Sorriso Ltda", { website: "https://sorriso.com.br", google_place_id: "gp1", phone: "(65) 3333-1111" });
    await db.execute(`INSERT INTO company_sources (company_id, source_type) VALUES ($1,'GOOGLE_PLACES')`, [dup]);
    const prospectId = await createProspect(dup);

    const r = await mergeCompanies(master, dup);
    expect(r.prospectsMerged).toBe(false);

    const [m] = await db.select<Record<string, unknown>[]>(`SELECT * FROM companies WHERE id = $1`, [master]);
    expect(m).toMatchObject({ website: "https://sorriso.com.br", google_place_id: "gp1", domain: "sorriso.com.br", lead_status: "READY" });
    expect(await db.select(`SELECT id FROM companies WHERE id = $1`, [dup])).toHaveLength(0);
    expect(await db.select(`SELECT id FROM company_sources WHERE company_id = $1`, [master])).toHaveLength(1);
    const [p] = await db.select<{ company_id: number }[]>(`SELECT company_id FROM prospects WHERE id = $1`, [prospectId]);
    expect(p.company_id).toBe(master);
  });

  it("when both are prospects, moves history to the master prospect", async () => {
    const master = await insert("Auto Center");
    const dup = await insert("Auto Center Prime");
    const masterProspect = await createProspect(master);
    const dupProspect = await createProspect(dup);
    await db.execute(`INSERT INTO activities (prospect_id, type, content) VALUES ($1,'MESSAGE_SENT','oi')`, [dupProspect]);

    const r = await mergeCompanies(master, dup);
    expect(r.prospectsMerged).toBe(true);
    expect(await db.select(`SELECT id FROM prospects`)).toHaveLength(1);
    const acts = await db.select<{ type: string }[]>(`SELECT type FROM activities WHERE prospect_id = $1`, [masterProspect]);
    expect(acts.map((a) => a.type)).toContain("MESSAGE_SENT");
    expect(acts.map((a) => a.type)).toContain("STATUS_CHANGED");
    const tasks = await db.select(`SELECT id FROM tasks WHERE prospect_id = $1`, [masterProspect]);
    expect(tasks).toHaveLength(2);
  });

  it("merging remembers the removed Google place so it is never collected again", async () => {
    const master = await insert("Clínica Alfa");
    const dup = await insert("Clinica Alfa Ltda", { google_place_id: "gp-dup" });
    await mergeCompanies(master, dup);
    const [seen] = await db.select<{ company_id: number }[]>(`SELECT company_id FROM seen_places WHERE google_place_id = 'gp-dup'`);
    expect(seen.company_id).toBe(master);
  });

  it("scan finds the pair and refuses to merge a record with itself", async () => {
    const a = await insert("Academia Força");
    await insert("ACADEMIA FORCA LTDA");
    const groups = await scanDuplicates();
    expect(groups).toHaveLength(1);
    await expect(mergeCompanies(a, a)).rejects.toThrow();
  });
});
