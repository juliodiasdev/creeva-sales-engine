import { fetchByIds, getSupabase, startOfTodayIso, unwrap } from "../../lib/store";

import { bestApproach } from "../contacts/contacts.service";
import { listApproachesForCompanies } from "../contacts/approaches.repository";
import { listChannelsForCompanies } from "../contacts/channels.repository";
import type { StoredChannel } from "../contacts/channels.repository";
import { consolidateChannels } from "../contacts/consolidate";
import { isCompanySuppressed, suppressedCompanyIds } from "../compliance/suppression.service";
import { getProspectContextRepository } from "../prospects/prospect.repository";
import { getNumberSetting } from "../settings/settings.service";
import { getTaskRepository } from "../tasks/task.repository";
import { listPendingTasks } from "../tasks/task.service";

import { buildOutreachMessage } from "./outreach.template";
import { markTaskAsSent, prepareAiOutreach } from "./outreach.service";

/** Toda 1ª mensagem leva a opção de sair (exigência de boa prática e LGPD). */
export const OPT_OUT_LINE = "Se preferir não receber mensagens, é só responder SAIR.";

export const hasOptOutLine = (message: string): boolean => /\bsair\b/i.test(message);

/** Garante a opção de sair no fim da mensagem (sem duplicar). */
export function finalizeFirstMessage(message: string): string {
  const text = message.trim();

  return hasOptOutLine(text) ? text : `${text}\n\n${OPT_OUT_LINE}`;
}

/** Segunda a sábado, das 8h às 19h no horário de Brasília. */
export function isBusinessHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);

  return weekday !== "Sun" && hour >= 8 && hour < 19;
}

export interface QueueItem {
  taskId: number;
  prospectId: number;
  companyId: number;
  companyName: string;
  whatsapp: StoredChannel;
  /** Mensagem pronta (já com a opção de sair). */
  message: string;
  source: "AI" | "TEMPLATE";
  /** Links "msg/" do WhatsApp Business não aceitam texto pré-preenchido. */
  canPrefill: boolean;
}

export interface QueueSummary {
  items: QueueItem[];
  /** Sem WhatsApp cadastrado: precisam de ligação ou outro canal. */
  withoutWhatsapp: { taskId: number; prospectId: number; companyId: number; companyName: string }[];
  /** Ignoradas por estarem na lista de "não contatar". */
  suppressed: number;
  sentToday: number;
  dailyLimit: number;
  businessHours: boolean;
}

export async function countSentToday(): Promise<number> {
  const rows = unwrap(
    await getSupabase()
      .from("activities")
      .select("id,metadata")
      .eq("type", "MESSAGE_SENT")
      .gte("occurred_at", startOfTodayIso()),
  ) as { id: number }[];

  return rows.length;
}

/**
 * Fila do dia: primeiros contatos pendentes com a mensagem pronta (IA ou
 * modelo), só para empresas com WhatsApp e fora da lista de supressão.
 * Nada é enviado: você abre o WhatsApp de cada uma e confirma o envio.
 */
export async function buildSendQueue(now = new Date()): Promise<QueueSummary> {
  const tasks = (await listPendingTasks()).filter((t) => t.type === "FIRST_CONTACT");
  const ids = [...new Set(tasks.map((t) => Number(t.company_id)))];

  const [blocked, channels, approaches, companies, sentToday, dailyLimit] = await Promise.all([
    suppressedCompanyIds(ids),
    listChannelsForCompanies(ids),
    listApproachesForCompanies(ids),
    fetchByIds<{ id: number; segment: string | null; city: string | null }>(
      "companies",
      "id,segment,city",
      "id",
      ids,
    ),
    countSentToday(),
    getNumberSetting("daily_send_limit", 20),
  ]);

  const items: QueueItem[] = [];
  const withoutWhatsapp: QueueSummary["withoutWhatsapp"] = [];
  let suppressed = 0;

  for (const task of tasks) {
    const companyId = Number(task.company_id);

    if (blocked.has(companyId)) {
      suppressed++;
      continue;
    }

    const mine = channels.filter((c) => Number(c.company_id) === companyId);
    const whatsapp = consolidateChannels(mine).main.find((c) => c.kind === "WHATSAPP");

    if (!whatsapp) {
      withoutWhatsapp.push({
        taskId: task.id,
        prospectId: task.prospect_id,
        companyId,
        companyName: task.company_name,
      });
      continue;
    }

    const approach = bestApproach(
      approaches.filter((a) => Number(a.company_id) === companyId),
      "WHATSAPP",
    );

    const company = companies.find((c) => Number(c.id) === companyId);

    const message =
      approach?.message ??
      buildOutreachMessage({
        taskType: "FIRST_CONTACT",
        companyName: task.company_name,
        segment: company?.segment ?? null,
        city: company?.city ?? null,
      });

    items.push({
      taskId: task.id,
      prospectId: task.prospect_id,
      companyId,
      companyName: task.company_name,
      whatsapp,
      message: finalizeFirstMessage(message),
      source: approach?.source ?? "TEMPLATE",
      canPrefill: !whatsapp.value.startsWith("msg/"),
    });
  }

  return {
    items,
    withoutWhatsapp,
    suppressed,
    sentToday,
    dailyLimit,
    businessHours: isBusinessHours(now),
  };
}

/** Reescreve a mensagem da fila com a IA (dados reais, sem preço/link). */
export async function rewriteQueueMessage(taskId: number): Promise<string> {
  const draft = await prepareAiOutreach(taskId);

  return finalizeFirstMessage(draft.message);
}

/**
 * Você confirma que enviou a mensagem no WhatsApp: registra no histórico e
 * no funil e agenda o retorno. Trava no limite diário e na lista de supressão.
 */
export async function confirmQueueSent(taskId: number, message: string): Promise<void> {
  const task = await getTaskRepository(taskId);

  if (!task) throw new Error("Tarefa não encontrada.");

  const prospect = await getProspectContextRepository(task.prospect_id);

  if (!prospect) throw new Error("Prospect não encontrado.");

  if (await isCompanySuppressed(Number(prospect.company_id))) {
    throw new Error("Esta empresa pediu para não ser contatada.");
  }

  const [sent, limit] = await Promise.all([
    countSentToday(),
    getNumberSetting("daily_send_limit", 20),
  ]);

  if (sent >= limit) {
    throw new Error(
      `Limite diário de ${limit} mensagens atingido. Aumente em Configurações se for seguro para o seu número.`,
    );
  }

  await markTaskAsSent(taskId, message);
}
