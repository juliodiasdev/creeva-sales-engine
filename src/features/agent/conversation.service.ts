import { createActivityRepository } from "../activities/activity.repository";
import { listProspectsRepository } from "../prospects/prospect.repository";
import type { ProspectStatus } from "../prospects/prospect.types";
import { recordReply, changeProspectStatus } from "../workflow/workflow.service";
import { cancelOpenTasksRepository } from "../tasks/task.repository";
import {
  isCompanySuppressed,
  looksLikeOptOut,
  suppressCompany,
} from "../compliance/suppression.service";

import {
  findProspectByCompanyRepository,
  getConversationRepository,
  getOrCreateConversationRepository,
  insertMessageRepository,
  listAllMessagesRepository,
  listMessagesRepository,
  updateConversationRepository,
} from "./agent.repository";

import type { Conversation, ConversationMessage } from "./agent.types";

export interface Thread {
  conversation: Conversation | null;
  messages: ConversationMessage[];
  /** Empresa na lista de supressão (nenhum contato deve ser feito). */
  suppressed: boolean;
  /** A última mensagem do contato parece pedir para parar (só um alerta). */
  optOutSuspected: boolean;
}

export async function loadThread(companyId: number): Promise<Thread> {
  const [conversation, messages, suppressed] = await Promise.all([
    getConversationRepository(companyId),
    listMessagesRepository(companyId),
    isCompanySuppressed(companyId),
  ]);

  const lastIn = [...messages].reverse().find((m) => m.direction === "IN");
  const lastActive = [...messages]
    .reverse()
    .find((m) => m.status !== "DRAFT");

  return {
    conversation,
    messages,
    suppressed: suppressed || conversation?.opted_out === 1,
    optOutSuspected:
      !!lastIn && lastActive?.id === lastIn.id && looksLikeOptOut(lastIn.body),
  };
}

/**
 * Registra uma mensagem que VOCÊ enviou (pelo WhatsApp/ligação) para
 * manter o histórico completo por empresa. Não altera o funil.
 */
export async function logOutgoingMessage(
  companyId: number,
  body: string,
  author: "HUMAN" | "AI" = "HUMAN",
): Promise<number> {
  const text = body.trim();

  if (!text) throw new Error("A mensagem não pode ficar vazia.");

  const conversation = await getOrCreateConversationRepository(companyId);

  return insertMessageRepository({
    conversationId: conversation.id,
    companyId,
    direction: "OUT",
    author,
    body: text,
    status: "SENT",
  });
}

/**
 * Registra a resposta do contato (colada do WhatsApp). Atualiza o funil:
 * o prospect passa a "Respondeu" e a tarefa de resposta é criada.
 */
export async function recordIncomingMessage(
  companyId: number,
  body: string,
): Promise<{ messageId: number; optOutSuspected: boolean }> {
  const text = body.trim();

  if (!text) throw new Error("Cole a resposta recebida.");

  const conversation = await getOrCreateConversationRepository(companyId);
  const prospect = await findProspectByCompanyRepository(companyId);

  const messageId = await insertMessageRepository({
    conversationId: conversation.id,
    companyId,
    direction: "IN",
    author: "LEAD",
    body: text,
    status: "RECEIVED",
  });

  if (prospect) {
    const status = prospect.status as ProspectStatus;

    if (["READY", "CONTACTED", "NURTURE"].includes(status)) {
      await recordReply(Number(prospect.id), text);
    } else if (!["WON", "LOST", "DISQUALIFIED", "DO_NOT_CONTACT"].includes(status)) {
      await createActivityRepository(
        Number(prospect.id),
        "REPLY_RECEIVED",
        text,
        "WHATSAPP",
      );
    }
  }

  return { messageId, optOutSuspected: looksLikeOptOut(text) };
}

/**
 * Confirma que a empresa pediu para não ser contatada: entra na lista de
 * supressão (por telefone, e-mail, domínio e CNPJ) e sai do funil.
 */
export async function confirmOptOut(
  companyId: number,
  reason = "Pediu para não ser contatada",
): Promise<void> {
  const conversation = await getOrCreateConversationRepository(companyId);

  await suppressCompany(companyId, reason);
  await updateConversationRepository(conversation.id, { opted_out: 1 });

  const prospect = await findProspectByCompanyRepository(companyId);

  if (prospect && prospect.status !== "DO_NOT_CONTACT") {
    await changeProspectStatus(Number(prospect.id), "DO_NOT_CONTACT");
    await cancelOpenTasksRepository(Number(prospect.id));
  }
}

/* ---------- visão geral (lista de conversas) ---------- */

export interface ConversationSummary {
  companyId: number;
  prospectId: number;
  companyName: string;
  segment: string | null;
  city: string | null;
  stage: ProspectStatus;
  lastBody: string | null;
  lastAt: string | null;
  /** O contato escreveu por último e ainda não há resposta nossa. */
  awaitingReply: boolean;
  hasDraft: boolean;
  optedOut: boolean;
  messageCount: number;
}

export async function listConversationSummaries(): Promise<
  ConversationSummary[]
> {
  const [prospects, messages] = await Promise.all([
    listProspectsRepository(),
    listAllMessagesRepository(),
  ]);

  const byCompany = new Map<number, typeof messages>();

  for (const m of messages) {
    const list = byCompany.get(Number(m.company_id)) ?? [];
    list.push(m);
    byCompany.set(Number(m.company_id), list);
  }

  const summaries = prospects.map((p): ConversationSummary => {
    const list = byCompany.get(Number(p.company_id)) ?? [];
    const sent = list.filter((m) => m.status !== "DRAFT");
    const last = sent[sent.length - 1];

    return {
      companyId: Number(p.company_id),
      prospectId: Number(p.id),
      companyName: p.company_name,
      segment: p.segment,
      city: p.city,
      stage: p.status,
      lastBody: last?.body ?? null,
      lastAt: last?.created_at ?? null,
      awaitingReply: last?.direction === "IN",
      hasDraft: list.some((m) => m.status === "DRAFT"),
      optedOut: p.status === "DO_NOT_CONTACT",
      messageCount: sent.length,
    };
  });

  // Quem respondeu e espera vem primeiro; depois rascunhos; depois o resto.
  const weight = (s: ConversationSummary) =>
    s.optedOut ? 3 : s.awaitingReply ? 0 : s.hasDraft ? 1 : 2;

  return summaries.sort(
    (a, b) =>
      weight(a) - weight(b) ||
      (b.lastAt ?? "").localeCompare(a.lastAt ?? ""),
  );
}
