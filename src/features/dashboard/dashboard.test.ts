import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../lib/database";

let db: Db;

vi.mock("../../lib/database", () => ({ getDatabase: async () => db }));
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import { createCompany } from "../companies/company.service";
import { createProspect } from "../prospects/prospect.service";
import { listPendingTasks } from "../tasks/task.service";
import { markTaskAsSent } from "../outreach/outreach.service";
import { markLost, markWon, recordReply, sendProposal } from "../workflow/workflow.service";
import { getDashboardMetrics } from "./dashboard.service";
import { exportBackup, importBackup, validateBackup } from "../backup/backup.service";
import { setSetting } from "../settings/settings.service";
import { ensurePlaybookSeed, findScript } from "../playbook/playbook.service";

async function prospect(name: string) {
  const id = await createCompany({ name, city: "Cuiabá" });
  return createProspect(id);
}

beforeEach(async () => {
  db = await createMigratedTestDb();
});

describe("dashboard", () => {
  it("computes real funnel metrics", async () => {
    const a = await prospect("A");
    const b = await prospect("B");
    await prospect("C");
    for (const t of await listPendingTasks()) await markTaskAsSent(t.id, "oi");
    await recordReply(a, "ok");
    await sendProposal(a, { value: 1000 });
    await markWon(a, { value: 1200 });
    await sendProposal(b, { value: 500 });
    await markLost(b, "PRICE");

    const m = await getDashboardMetrics();
    expect(m).toMatchObject({
      prospects: 3, contactsSent: 3, replies: 1, proposals: 2,
      won: 1, lost: 1, revenue: 1200, averageTicket: 1200, pipelineValue: 0,
    });
    expect(m.replyRate).toBeCloseTo(1 / 3);
    expect(m.closeRate).toBe(0.5);
  });
});

describe("backup", () => {
  it("round-trips data, excludes secrets, rejects bad files", async () => {
    await prospect("A");
    await setSetting("openai_api_key", "sk-secret");
    await setSetting("seller_name", "Júlio");

    const file = await exportBackup();
    expect(JSON.stringify(file)).not.toContain("sk-secret");

    await db.execute("DELETE FROM companies");
    await importBackup(JSON.parse(JSON.stringify(file)));

    const [{ n }] = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM prospects");
    expect(n).toBe(1);
    const keys = await db.select<{ value: string }[]>("SELECT value FROM settings WHERE key='openai_api_key'");
    expect(keys[0].value).toBe("sk-secret");

    await expect(validateBackup({ format: "x" })).rejects.toThrow();
    await expect(validateBackup({ ...file, schemaVersion: 999 })).rejects.toThrow(/mais novo/);
    await expect(validateBackup({ ...file, tables: { companies: [{ evil: 1 }] } })).rejects.toThrow(/desconhecida/);
  });
});

describe("playbook", () => {
  it("seeds and resolves by segment with fallback", async () => {
    await ensurePlaybookSeed();
    expect((await findScript("Clínica Odontologia", "FIRST_CONTACT"))?.segment).toBe("odontologia");
    expect((await findScript("Padaria", "FIRST_CONTACT"))?.segment).toBe("serviços locais");
  });
});

import { clearApiKeys, clearBusinessData, resetEverything } from "../backup/reset.service";

describe("reset", () => {
  it("clears keys only, then business data, then everything", async () => {
    await prospect("A");
    await setSetting("openai_api_key", "sk-x");
    await setSetting("seller_name", "Júlio");
    await ensurePlaybookSeed();

    const count = async (t: string) =>
      (await db.select<{ n: number }[]>(`SELECT COUNT(*) n FROM ${t}`))[0].n;

    await clearApiKeys();
    expect(await count("settings")).toBe(1);
    expect(await count("companies")).toBe(1);

    await clearBusinessData();
    for (const t of ["companies", "prospects", "tasks", "activities", "jobs"]) {
      expect(await count(t)).toBe(0);
    }
    expect(await count("settings")).toBe(1);

    await prospect("B");
    const [{ id }] = await db.select<{ id: number }[]>("SELECT id FROM companies");
    expect(id).toBe(1); // contador de ids reiniciado

    await resetEverything();
    expect(await count("settings")).toBe(0);
    expect(await count("companies")).toBe(0);
    expect(await count("playbook_scripts")).toBeGreaterThan(0);
  });
});
