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
import { saveChannelsRepository } from "../contacts/channels.repository";
import { replaceApproachesRepository } from "../contacts/approaches.repository";
import { suppressCompany } from "../compliance/suppression.service";
import { createProspect } from "../prospects/prospect.service";
import { setSetting } from "../settings/settings.service";
import { ensureServicesSeed } from "../services/services.service";
import { loadThread } from "../agent/conversation.service";
import { listPendingTasks } from "../tasks/task.service";
import {
  OPT_OUT_LINE,
  buildSendQueue,
  confirmQueueSent,
  finalizeFirstMessage,
  isBusinessHours,
} from "./queue.service";

async function inQueue(name: string, phone: string | null, whatsapp = true) {
  const id = (await importCompany({ name, city: "Cuiabá", segment: "Odontologia", ...(phone ? { phone } : {}) }, "MANUAL")).id;

  if (phone && whatsapp) {
    const digits = phone.replace(/\D/g, "");
    await saveChannelsRepository(id, [
      { kind: "WHATSAPP", value: digits, url: `https://wa.me/55${digits}`, label: "confirmado no site", source: "WEBSITE" },
    ]);
  }

  await createProspect(id);
  return id;
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  await ensureServicesSeed();
});

describe("finalizeFirstMessage", () => {
  it("acrescenta a opção de sair uma única vez", () => {
    const once = finalizeFirstMessage("Olá! Tudo bem?");
    expect(once).toContain(OPT_OUT_LINE);
    expect(finalizeFirstMessage(once)).toBe(once);
    expect(finalizeFirstMessage("Oi! Responda SAIR para parar.")).toBe("Oi! Responda SAIR para parar.");
  });
});

describe("isBusinessHours", () => {
  it("considera seg–sáb, 8h–19h no horário de Brasília", () => {
    expect(isBusinessHours(new Date("2026-10-13T15:00:00Z"))).toBe(true); // terça 12h
    expect(isBusinessHours(new Date("2026-10-13T23:30:00Z"))).toBe(false); // terça 20h30
    expect(isBusinessHours(new Date("2026-10-13T09:00:00Z"))).toBe(false); // terça 6h
    expect(isBusinessHours(new Date("2026-10-18T15:00:00Z"))).toBe(false); // domingo
    expect(isBusinessHours(new Date("2026-10-17T15:00:00Z"))).toBe(true); // sábado
  });
});

describe("fila de envio", () => {
  it("monta a mensagem de cada empresa com WhatsApp e separa quem não tem", async () => {
    await inQueue("Com WhatsApp", "(65) 99999-0001");
    await inQueue("Sem WhatsApp", "(65) 3333-0002", false);

    const q = await buildSendQueue(new Date("2026-10-13T15:00:00Z"));

    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ companyName: "Com WhatsApp", source: "TEMPLATE", canPrefill: true });
    expect(q.items[0].message).toContain("Com WhatsApp");
    expect(q.items[0].message).toContain(OPT_OUT_LINE);
    expect(q.withoutWhatsapp.map((c) => c.companyName)).toEqual(["Sem WhatsApp"]);
    expect(q).toMatchObject({ sentToday: 0, dailyLimit: 20, businessHours: true, suppressed: 0 });
  });

  it("prefere a abordagem da IA e exclui quem pediu para não ser contatado", async () => {
    const a = await inQueue("Clínica A", "(65) 99999-0003");
    const b = await inQueue("Clínica B", "(65) 99999-0004");

    await replaceApproachesRepository(a, "AI", [
      { channel: "WHATSAPP", service_key: null, angle: "x", message: "Mensagem da IA para a Clínica A", evidence_used: [] },
    ]);
    await suppressCompany(b, "pediu para parar");

    const q = await buildSendQueue();

    expect(q.items.map((i) => i.companyName)).toEqual(["Clínica A"]);
    expect(q.items[0]).toMatchObject({ source: "AI" });
    expect(q.items[0].message.startsWith("Mensagem da IA para a Clínica A")).toBe(true);
    expect(q.suppressed).toBe(1);
  });

  it("confirmar o envio registra no histórico e no funil e agenda o retorno", async () => {
    const id = await inQueue("Clínica C", "(65) 99999-0005");
    const [item] = (await buildSendQueue()).items;

    await confirmQueueSent(item.taskId, item.message);

    const thread = await loadThread(id);
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ direction: "OUT", author: "HUMAN", status: "SENT" });

    expect((await buildSendQueue()).items).toHaveLength(0);
    expect((await buildSendQueue()).sentToday).toBe(1);
    expect((await listPendingTasks()).filter((t) => t.type === "FIRST_CONTACT")).toHaveLength(0);
  });

  it("trava no limite diário", async () => {
    await setSetting("daily_send_limit", "1");
    await inQueue("Primeira", "(65) 99999-0006");
    await inQueue("Segunda", "(65) 99999-0007");

    const { items } = await buildSendQueue();
    await confirmQueueSent(items[0].taskId, items[0].message);

    await expect(confirmQueueSent(items[1].taskId, items[1].message)).rejects.toThrow(/Limite diário/);
  });

  it("não confirma envio para empresa que pediu para parar depois de entrar na fila", async () => {
    const id = await inQueue("Clínica D", "(65) 99999-0008");
    const [item] = (await buildSendQueue()).items;

    await suppressCompany(id, "pediu para parar");

    await expect(confirmQueueSent(item.taskId, item.message)).rejects.toThrow(/não ser contatada/);
  });
});
