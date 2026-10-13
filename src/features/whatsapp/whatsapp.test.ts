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
  isMediaPlaceholder,
  lastInboundAt,
  retryFailedMessages,
  syncWhatsAppInbox,
  windowOpenFromInbound,
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
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("abre só com mensagem que a Meta recebeu nas últimas 24h", () => {
    expect(windowOpenFromInbound(ago(2), now)).toBe(true);
    expect(windowOpenFromInbound(ago(25), now)).toBe(false);
    expect(windowOpenFromInbound(null, now)).toBe(false);
    expect(windowOpenFromInbound(new Date(now.getTime() + 3_600_000).toISOString(), now)).toBe(false);
  });

  it("resposta colada à mão ou ligação NÃO abre a janela; o evento real da Meta abre", async () => {
    const id = (await importCompany({ name: "Janela", city: "Cuiabá", phone: "(65) 99888-0001" }, "MANUAL")).id;
    await createProspect(id);

    await recordIncomingMessage(id, "Colei esta resposta agora");
    expect(await lastInboundAt(id)).toBeNull();

    await event("wj1", "5565998880001", "Oi pelo WhatsApp oficial", { event_at: "2026-10-13T10:00:00.000Z" });
    await syncWhatsAppInbox();
    expect(await lastInboundAt(id)).toBe("2026-10-13T10:00:00.000Z");
  });
});

describe("mídia e falhas", () => {
  it("reconhece o aviso de mídia sem texto", () => {
    expect(isMediaPlaceholder("[áudio recebido: abra no WhatsApp para ouvir]")).toBe(true);
    expect(isMediaPlaceholder("[imagem recebida]")).toBe(true);
    expect(isMediaPlaceholder("[vídeo recebido: pare de me mandar]")).toBe(true);
    expect(isMediaPlaceholder("Oi, [áudio] ok")).toBe(false);
  });

  it("o Claude não responde quando a última mensagem é só mídia (pode ser pedido de parar)", async () => {
    const id = (await importCompany({ name: "Só Áudio", city: "Cuiabá", phone: "(65) 99888-0002" }, "MANUAL")).id;
    await createProspect(id);
    await planCompanyWithAi(id, vi.fn().mockResolvedValue({
      json: { summary: "s", main_problem: "p", opportunity: "o", recommended_offer: "r", outreach_angle: "a", confidence: 0.5, recommended_services: [], bottlenecks: [], approaches: [] },
      model: "m",
    }));
    await recordIncomingMessage(id, "[áudio recebido: abra no WhatsApp para ouvir]");

    await expect(draftReply(id, {}, vi.fn().mockResolvedValue({ json: reply, model: "m" }))).rejects.toThrow(/mídia/);
  });

  it("falha passageira volta para a fila e só vira 'falhou' depois de 3 tentativas; claim travado é liberado", async () => {
    const id = (await importCompany({ name: "Falha Rede", city: "Cuiabá", phone: "(65) 99888-0003" }, "MANUAL")).id;
    await createProspect(id);
    await event("wf1", "5565998880003", "Pare de me mandar mensagem");

    const supabase = getSupabase();
    const original = supabase.from.bind(supabase);
    let broken = true;
    vi.spyOn(supabase, "from").mockImplementation(((table: string) => {
      if (broken && table === "suppressions") throw new Error("rede caiu");
      return original(table);
    }) as never);

    // 1ª e 2ª tentativas: volta para a fila; 3ª: falhou de vez.
    for (const expected of [0, 0, 1]) {
      expect((await syncWhatsAppInbox()).failed).toBe(expected);
    }

    expect(await countFailedMessages()).toBe(1);

    // Com a rede de volta, "Tentar de novo" importa e o pedido de parar vale.
    broken = false;
    expect(await retryFailedMessages()).toMatchObject({ imported: 1 });
    expect(await isCompanySuppressed(id)).toBe(true);
    vi.restoreAllMocks();

    // Evento que ficou "em processamento" (app fechou no meio) volta sozinho depois do prazo.
    await getSupabase().from("whatsapp_events").insert({
      wamid: "wf2", direction: "IN", status: "received", phone: "5565998880099", body: "Oi",
      processed: 4, claimed_at: "2020-01-01T00:00:00.000Z",
    });
    expect(await syncWhatsAppInbox()).toMatchObject({ unknown: 1 });
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

  it("se a Meta aceitar mas o funil falhar, a mensagem fica no histórico e o rascunho sai da fila", async () => {
    const { id, draft } = await ready("(65) 99225-0342", "Clínica Registro");
    sendWhatsAppText.mockResolvedValue({ wamid: "wamid.OUT2" });

    const agent = await import("../agent/agent.service");
    vi.spyOn(agent, "approveDraft").mockRejectedValueOnce(new Error("banco indisponível"));

    await expect(sendDraftViaWhatsApp(draft.messageId, "Olá, tudo bem?")).rejects.toThrow(/FOI enviada/);

    const messages = (await loadThread(id)).messages;
    expect(messages.filter((m) => m.status === "SENT" && m.author === "AI").map((m) => m.body)).toEqual(["Olá, tudo bem?"]);
    expect(messages.filter((m) => m.status === "DRAFT")).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("se a Meta recusar, o rascunho continua pendente (nada é registrado como enviado)", async () => {
    const { id, draft } = await ready();
    sendWhatsAppText.mockRejectedValue(new Error("Token da Meta inválido"));

    await expect(sendDraftViaWhatsApp(draft.messageId, "Oi")).rejects.toThrow(/Token/);
    expect((await loadThread(id)).messages.at(-1)).toMatchObject({ status: "DRAFT" });
  });

  it("bloqueia empresa suprimida e janela fechada, e não envia duas vezes", async () => {
    const { id, draft } = await ready();

    await getSupabase().from("whatsapp_events").update({ event_at: "2020-01-01T00:00:00.000Z" }).eq("direction", "IN");
    await expect(sendDraftViaWhatsApp(draft.messageId, "Oi")).rejects.toThrow(/24 horas/);
    expect(sendWhatsAppText).not.toHaveBeenCalled();

    await getSupabase().from("whatsapp_events").update({ event_at: new Date().toISOString() }).eq("direction", "IN");
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
