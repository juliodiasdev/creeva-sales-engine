import { getSupabase, unwrap } from "../../lib/store";

import { approveDraft } from "../agent/agent.service";
import { getMessageRepository, listMessagesRepository } from "../agent/agent.repository";
import { isCompanySuppressed } from "../compliance/suppression.service";
import { listChannelsRepository } from "../contacts/channels.repository";
import { consolidateChannels } from "../contacts/consolidate";

import { serviceWindowOpen, syncWhatsAppInbox } from "./inbox.service";
import { sendWhatsAppText } from "./whatsapp.client";

/** Número do contato: o mesmo que escreveu para nós; senão o WhatsApp cadastrado. */
export async function replyNumber(companyId: number): Promise<string | null> {
  const lastIn = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("phone")
      .eq("direction", "IN")
      .eq("company_id", companyId)
      .order("id", { ascending: false })
      .limit(1),
  ) as { phone: string | null }[];

  if (lastIn[0]?.phone) return lastIn[0].phone;

  const channels = await listChannelsRepository(companyId);
  const wa = consolidateChannels(channels).main.find(
    (c) => c.kind === "WHATSAPP" && /^\d+$/.test(c.value),
  );

  return wa ? `55${wa.value}` : null;
}

const sending = new Set<number>();

/**
 * Envia o rascunho APROVADO por você pelo WhatsApp oficial. Só responde dentro
 * da janela de 24 horas aberta pelo contato; fora dela é preciso um modelo
 * aprovado pela Meta (ainda não suportado) ou enviar manualmente.
 */
export async function sendDraftViaWhatsApp(
  messageId: number,
  text: string,
): Promise<{ wamid: string }> {
  if (sending.has(messageId)) throw new Error("Este envio já está em andamento.");

  sending.add(messageId);

  try {
    // Aplica antes qualquer pedido de parar que ainda não foi importado.
    await syncWhatsAppInbox().catch(() => undefined);

    const draft = await getMessageRepository(messageId);

    if (!draft || draft.status !== "DRAFT" || draft.direction !== "OUT") {
      throw new Error("Rascunho não encontrado ou já tratado.");
    }

    const companyId = Number(draft.company_id);

    if (await isCompanySuppressed(companyId)) {
      throw new Error("Esta empresa pediu para não ser contatada.");
    }

    const messages = await listMessagesRepository(companyId);

    if (!serviceWindowOpen(messages)) {
      throw new Error(
        "A janela de 24 horas está fechada: a pessoa não escreveu no WhatsApp nas últimas 24h. Envie manualmente pelo seu WhatsApp.",
      );
    }

    const to = await replyNumber(companyId);

    if (!to) throw new Error("Esta empresa não tem WhatsApp cadastrado.");

    const final = text.trim();

    if (!final) throw new Error("A mensagem não pode ficar vazia.");

    const { wamid } = await sendWhatsAppText(to, final);

    // Registra no histórico e no funil (compare-and-set: sem envio duplicado).
    try {
      await approveDraft(messageId, final);
    } catch {
      throw new Error(
        "A mensagem FOI enviada pelo WhatsApp, mas não conseguimos registrar no histórico. Não envie de novo: use “Já enviei (por fora)”.",
      );
    }

    return { wamid };
  } finally {
    sending.delete(messageId);
  }
}
