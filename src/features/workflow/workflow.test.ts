import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../lib/database";

let db: Db;

vi.mock("../../lib/database", () => ({
  getDatabase: async () => db,
}));

import { createCompany } from "../companies/company.service";
import { createProspect } from "../prospects/prospect.service";
import { listPendingTasks } from "../tasks/task.service";
import {
  markTaskAsSent,
} from "../outreach/outreach.service";
import {
  changeProspectStatus,
  markLost,
  markWon,
  recordMeeting,
  recordReply,
  rescheduleTask,
  sendProposal,
} from "./workflow.service";

async function newProspect(): Promise<number> {
  await createCompany({ name: "Clínica X", segment: "Odontologia", city: "Cuiabá" });
  const [c] = await db.select<{ id: number }[]>("SELECT id FROM companies");
  return createProspect(c.id);
}

const q = <T>(sql: string, p?: unknown[]) => db.select<T[]>(sql, p);

beforeEach(async () => {
  db = await createMigratedTestDb();
});

describe("outreach", () => {
  it("first contact -> CONTACTED + follow-up D+2 hidden from Today", async () => {
    const pid = await newProspect();
    const [task] = await listPendingTasks();
    expect(task.type).toBe("FIRST_CONTACT");

    await markTaskAsSent(task.id, "Olá!");

    const [p] = await q<{ status: string; next_action: string }>("SELECT * FROM prospects");
    expect(p.status).toBe("CONTACTED");
    expect(p.next_action).toBe("Fazer follow-up");

    const acts = await q<{ type: string; channel: string }>("SELECT * FROM activities WHERE type='MESSAGE_SENT'");
    expect(acts).toHaveLength(1);
    expect(acts[0].channel).toBe("MANUAL");

    expect(await listPendingTasks()).toHaveLength(0);
    const fu = await q<{ due_at: string }>("SELECT * FROM tasks WHERE type='FOLLOW_UP'");
    expect(fu).toHaveLength(1);

    await expect(markTaskAsSent(task.id, "Olá!")).rejects.toThrow();
    expect(pid).toBeGreaterThan(0);
  });
});

describe("sales cycle", () => {
  it("reply -> meeting -> proposal -> won, with history", async () => {
    const pid = await newProspect();
    await recordReply(pid, "Tenho interesse");
    await recordMeeting(pid, { scheduledAt: "2026-11-01 10:00", need: "Site novo" });
    await sendProposal(pid, { value: 3000, serviceType: "Site", validDays: 7 });
    await markWon(pid, { value: 2800, serviceType: "Site", recurring: true });

    const [p] = await q<{ status: string; closed_at: string }>("SELECT * FROM prospects");
    expect(p.status).toBe("WON");
    expect(p.closed_at).toBeTruthy();

    const [d] = await q<{ status: string; value: number }>("SELECT * FROM deals");
    expect(d).toMatchObject({ status: "WON", value: 2800 });

    const types = (await q<{ type: string }>("SELECT type FROM activities ORDER BY id")).map((a) => a.type);
    expect(types).toEqual([
      "PROSPECT_CREATED",
      "REPLY_RECEIVED",
      "STATUS_CHANGED",
      "MEETING",
      "STATUS_CHANGED",
      "PROPOSAL_SENT",
      "STATUS_CHANGED",
      "WON",
      "STATUS_CHANGED",
    ]);

    const open = await q("SELECT * FROM tasks WHERE completed_at IS NULL");
    expect(open).toHaveLength(0);
  });

  it("LOST requires a valid reason and closes deal", async () => {
    const pid = await newProspect();
    await sendProposal(pid, { value: 1000 });
    // @ts-expect-error razão inválida
    await expect(markLost(pid, "", "x")).rejects.toThrow();
    await markLost(pid, "PRICE");
    const [d] = await q<{ status: string; lost_reason: string }>("SELECT * FROM deals");
    expect(d).toMatchObject({ status: "LOST", lost_reason: "PRICE" });
    const [p] = await q<{ lost_reason: string }>("SELECT * FROM prospects");
    expect(p.lost_reason).toBe("PRICE");
  });

  it("guarded statuses cannot be set directly; simple ones log history", async () => {
    const pid = await newProspect();
    await expect(changeProspectStatus(pid, "WON")).rejects.toThrow();
    await changeProspectStatus(pid, "NURTURE");
    const acts = await q<{ metadata: string }>("SELECT * FROM activities WHERE type='STATUS_CHANGED'");
    expect(JSON.parse(acts[0].metadata)).toMatchObject({ from: "READY", to: "NURTURE" });
    expect(await listPendingTasks()).toHaveLength(0);
  });

  it("rescheduled task leaves Today until due", async () => {
    await newProspect();
    const [t] = await listPendingTasks();
    await rescheduleTask(t.id, 2);
    expect(await listPendingTasks()).toHaveLength(0);
  });
});
