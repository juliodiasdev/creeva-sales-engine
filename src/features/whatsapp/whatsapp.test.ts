import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

const sendWhatsAppText = vi.fn();
vi.mock("./whatsapp.client", async (orig) => ({
  ...(await orig<typeof import("./whatsapp.client")>()),
  sendWhatsAppText: (...a: unknown[]) => sendWhatsAppText(...a),
}));

import { importCompany } from "../companies/company.service";
import { saveChannelsRepository } from "../contacts/channels.repository";
import { createProspect } from "../prospects/prospect.service";
import { ensureServicesSeed } from "../services/services.service";
import { planCompanyWithAi } from "../ai/ai.service";
import { draftReply } from "../agent/agent.service";
import { listConversationSummaries, loadThread, recordIncomingMessage } from "../agent/conversation.service";
import { isCompanySuppressed } from "../compliance/suppression.service";
import { getSupabase } from "../../lib/supabase";
import { phoneVariants } from "./phone";
import {
  countFailedMessages,
  dismissDeliveryFailure,
  dismissUnknownMessage,
  findCompanyByPhone,
  listDeliveryFailures,
  listUnknownMessages,
  retryFailedMessages,
  serviceWindowOpen,
  syncWhatsAppInbox,
} from "./inbox.service";
import { sendDraftViaWhatsApp } from "./send.service";

async function event(wamid: string, phone: string, body: string, extra: Record<string, unknown> = {}) {
  await getSupabase().from("whatsapp_events").insert({
    wamid, direction: "IN", status: "received", phone, body, ...extra,
  });
}

const reply = { message: "Obrigado pelo retorno!", intent: "CONTINUE", handoff_reason: null, evidence_used: [] };

beforeEach(async () => {
  db = await createMigratedTestDb();
  await ensureServicesSeed();
  sendWhatsAppText.mockReset();
});

describe("phoneVariants", () => {
  it("cobre celular com e sem o 9º dígito e remove o 55", () => {
    expect(phoneVariants("5565992250342")).toEqual(expect.arrayContaining(["65992250342", "6592250342"]));
    expect(phoneVariants("556592250342")).toEqual(expect.arrayContaining(["6592250342", "65992250342"]));
    expect(phoneVariants("(65) 3333-1111")).toEqual(["6533331111"]);
    expect(phoneVariants("123")).toEqual([]);
  });
});

describe("caixa de entrada do WhatsApp", () => {
  it("liga o número da Meta (sem o 9) ao cadastro da empresa e atualiza o funil", async () => {
    const id = (await importCompany({ name: "Clínica Sorriso", city: "Cuiabá", phone: "(65) 99225-0342" }, "MANUAL")).id;
    await createProspect(id);

    await event("w1", "556592250342", "Oi! Como funciona?"); // Meta enviou sem o 9

    expect(await findCompanyByPhone("556592250342")).toBe(id);
    expect(await syncWhatsAppInbox()).toEqual({ imported: 1, unknown: 0, failed: 0 });

    const thread = await loadThread(id);
    expect(thread.messages.map((m) => `${m.direction}:${m.body}`)).toEqual(["IN:Oi! Como funciona?"]);
    expect((await listConversationSummaries())[0]).toMatchObject({ stage: "REPLIED", awaitingReply: true });

    // Segunda leitura não duplica.
    expect(await syncWhatsAppInbox()).toEqual({ imported: 0, unknown: 0, failed: 0 });
    expect((await loadThread(id)).messages).toHaveLength(1);
  });

  it("encontra a empresa também pelo WhatsApp encontrado no site", async () => {
    const id = (await importCompany({ name: "Outra Clínica", city: "Cuiabá" }, "MANUAL")).id;
    await saveChannelsRepository(id, [
      { kind: "WHATSAPP", value: "65988887777", url: "https://wa.me/5565988887777", label: null, source: "WEBSITE" },
    ]);

    expect(await findCompanyByPhone("5565988887777")).toBe(id);
  });

  it("pedido de parar por WhatsApp suprime a empresa; número desconhecido fica à parte", async () => {
    const id = (await importCompany({ name: "Clínica Parar", city: "Cuiabá", phone: "(65) 99111-2222" }, "MANUAL")).id;
    await createProspect(id);

    await event("w2", "5565991112222", "Pare de me mandar mensagem");
    await event("w3", "5511977776666", "Quem é você?");

    expect(await syncWhatsAppInbox()).toEqual({ imported: 1, unknown: 1, failed: 0 });
    expect(await isCompanySuppressed(id)).toBe(true);

    const unknown = await listUnknownMessages();
    expect(unknown.map((u) => u.body)).toEqual(["Quem é você?"]);

    await dismissUnknownMessage(unknown[0].id);
    expect(await listUnknownMessages()).toEqual([]);
  });

  it("não reprocessa o que outra execução já reivindicou", async () => {
    const id = (await importCompany({ name: "Clínica Corrida", city: "Cuiabá", phone: "(65) 99333-4444" }, "MANUAL")).id;
    await createProspect(id);
    await event("w4", "5565993334444", "Olá");

    const [a, b] = await Promise.all([syncWhatsAppInbox(), syncWhatsAppInbox()]);

    expect(a).toEqual(b); // a segunda chamada aproveita a mesma execução
    expect(a.imported).toBe(1);
    expect((await loadThread(id)).messages).toHaveLength(1);
  });
});

describe("caixa de entrada: casos de borda", () => {
  it("pedido de parar de um número sem empresa suprime o telefone mesmo assim", async () => {
    await event("wx1", "5511988887777", "Pare de me mandar mensagem");
    await syncWhatsAppInbox();

    const outro = (await importCompany({ name: "Chegou Depois", city: "SP", phone: "(11) 98888-7777" }, "MANUAL")).id;
    expect(await isCompanySuppressed(outro)).toBe(true);
  });

  it("empresa que ainda não está em abordagem fica na lista de fora da abordagem, com o nome", async () => {
    const id = (await importCompany({ name: "Sem Abordagem", city: "Cuiabá", phone: "(65) 99555-6666" }, "MANUAL")).id;
    await event("wx2", "5565995556666", "Vi o anúncio de vocês");

    expect(await syncWhatsAppInbox()).toEqual({ imported: 0, unknown: 1, failed: 0 });
    expect(await listUnknownMessages()).toMatchObject([{ company_id: id, company_name: "Sem Abordagem" }]);
  });

  it("usa o horário real da mensagem (não o do sync) e reimporta o que falhou", async () => {
    const id = (await importCompany({ name: "Horário Real", city: "Cuiabá", phone: "(65) 99777-8888" }, "MANUAL")).id;
    await createProspect(id);
    await event("wx3", "5565997778888", "Bom dia", { event_at: "2026-10-12T09:00:00.000Z" });

    expect(await syncWhatsAppInbox()).toMatchObject({ imported: 1 });
    expect((await loadThread(id)).messages[0].created_at.startsWith("2026-10-12T09:00:00")).toBe(true);

    // Falha simulada: evento volta como "falhou" e é reimportado pelo botão.
    await getSupabase().from("whatsapp_events").insert({ wamid: "wx4", direction: "IN", status: "received", phone: "5565997778888", body: "Segunda", processed: 3 });
    expect(await countFailedMessages()).toBe(1);
    expect(await retryFailedMessages()).toMatchObject({ imported: 1 });
    expect(await countFailedMessages()).toBe(0);
  });

  it("falha de entrega avisada pela Meta aparece para você dispensar", async () => {
    await getSupabase().from("whatsapp_events").insert({ wamid: "wx5", direction: "STATUS", status: "failed", phone: "5565990001111", body: "Número sem WhatsApp" });

    const [failure] = await listDeliveryFailures();
    expect(failure).toMatchObject({ phone: "5565990001111", reason: "Número sem WhatsApp" });

    await dismissDeliveryFailure(failure.id);
    expect(await listDeliveryFailures()).toEqual([]);
  });
});

describe("janela de 24 horas", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const msg = (direction: string, body: string, hoursAgo: number, status = "RECEIVED") => ({
    direction, body, status, created_at: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  });

  it("abre só com mensagem do contato nas últimas 24h; ligação não conta", () => {
    expect(serviceWindowOpen([msg("IN", "Oi", 2)], now)).toBe(true);
    expect(serviceWindowOpen([msg("IN", "Oi", 25)], now)).toBe(false);
    expect(serviceWindowOpen([msg("OUT", "Olá", 1, "SENT")], now)).toBe(false);
    expect(serviceWindowOpen([msg("IN", "[Ligação] Atendeu e tem interesse", 1)], now)).toBe(false);
    expect(serviceWindowOpen([msg("IN", "Oi", 30), msg("IN", "Voltei", 1)], now)).toBe(true);
  });
});

describe("enviar rascunho pelo WhatsApp", () => {
  async function ready(phone = "(65) 99225-0342", name = "Clínica Envio", wa = "556592250342") {
    const id = (await importCompany({ name, city: "Cuiabá", phone }, "MANUAL")).id;
    await createProspect(id);
    await planCompanyWithAi(id, vi.fn().mockResolvedValue({
      json: { summary: "s", main_problem: "p", opportunity: "o", recommended_offer: "r", outreach_angle: "a", confidence: 0.5, recommended_services: [], bottlenecks: [], approaches: [] },
      model: "m",
    }));
    await event(`w-${name}`, wa, "Pode falar");
    await syncWhatsAppInbox();
    const draft = await draftReply(id, {}, vi.fn().mockResolvedValue({ json: reply, model: "m" }));
    return { id, draft };
  }

  it("envia para o número que escreveu, depois registra no histórico", async () => {
    const { id, draft } = await ready();
    sendWhatsAppText.mockResolvedValue({ wamid: "wamid.OUT1" });

    await expect(sendDraftViaWhatsApp(draft.messageId, "Obrigado! Posso explicar?")).resolves.toEqual({ wamid: "wamid.OUT1" });

    expect(sendWhatsAppText).toHaveBeenCalledWith("556592250342", "Obrigado! Posso explicar?");
    const sent = (await loadThread(id)).messages.at(-1)!;
    expect(sent).toMatchObject({ status: "SENT", author: "AI", edited: 1, body: "Obrigado! Posso explicar?" });
  });

  it("se a Meta recusar, o rascunho continua pendente (nada é registrado como enviado)", async () => {
    const { id, draft } = await ready();
    sendWhatsAppText.mockRejectedValue(new Error("Token da Meta inválido"));

    await expect(sendDraftViaWhatsApp(draft.messageId, "Oi")).rejects.toThrow(/Token/);
    expect((await loadThread(id)).messages.at(-1)).toMatchObject({ status: "DRAFT" });
  });

  it("bloqueia empresa suprimida e janela fechada, e não envia duas vezes", async () => {
    const { id, draft } = await ready();

    await getSupabase().from("conversation_messages").update({ created_at: "2020-01-01T00:00:00.000Z" }).eq("direction", "IN");
    await expect(sendDraftViaWhatsApp(draft.messageId, "Oi")).rejects.toThrow(/24 horas/);
    expect(sendWhatsAppText).not.toHaveBeenCalled();

    await getSupabase().from("conversation_messages").update({ created_at: new Date().toISOString() }).eq("direction", "IN");
    sendWhatsAppText.mockImplementation(() => new Promise((r) => setTimeout(() => r({ wamid: "w" }), 20)));
    const results = await Promise.allSettled([
      sendDraftViaWhatsApp(draft.messageId, "Oi"),
      sendDraftViaWhatsApp(draft.messageId, "Oi"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);

    // Empresa que pediu para parar nunca recebe.
    const { id: other, draft: d2 } = await ready("(65) 99444-5555", "Clínica Parar2", "5565994445555");
    await recordIncomingMessage(other, "Pare de me mandar mensagem");
    await expect(sendDraftViaWhatsApp(d2.messageId, "Oi")).rejects.toThrow(/não ser contatada|já tratado/);
    expect(id).toBeGreaterThan(0);
  });
});
