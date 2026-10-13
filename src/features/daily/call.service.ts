import { getSupabase, unwrap } from "../../lib/store";

import { createActivityRepository } from "../activities/activity.repository";
import {
  getOrCreateConversationRepository,
  insertMessageRepository,
} from "../agent/agent.repository";
import { confirmOptOut } from "../agent/conversation.service";
import { getLatestAnalysis, parseBottlenecks } from "../ai/ai.service";
import type { AiBottleneck } from "../ai/ai.validation";
import { isCompanySuppressed } from "../compliance/suppression.service";
import { STATE_LABEL } from "../automation/automation.engine";
import type { AutomationState } from "../automation/automation.engine";
import { getPresence } from "../presence/presence.service";
import { consolidateChannels } from "../contacts/consolidate";
import { listChannelsRepository } from "../contacts/channels.repository";
import type { StoredChannel } from "../contacts/channels.repository";
import { getProspectContextRepository } from "../prospects/prospect.repository";
import {
  createTaskRepository,
  listTasksByProspectRepository,
  rescheduleTaskRepository,
} from "../tasks/task.repository";
import { changeProspectStatus, markLost, recordReply } from "../workflow/workflow.service";

export type CallOutcome =
  | "NO_ANSWER"
  | "CALLBACK"
  | "INTERESTED"
  | "NOT_INTERESTED"
  | "WRONG_NUMBER"
  | "DO_NOT_CONTACT";

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  NO_ANSWER: "Não atendeu",
  CALLBACK: "Pediu para ligar depois",
  INTERESTED: "Atendeu e tem interesse",
  NOT_INTERESTED: "Atendeu, sem interesse",
  WRONG_NUMBER: "Número errado",
  DO_NOT_CONTACT: "Pediu para não ser contatado",
};

/** Ligações em que alguém da empresa falou conosco (contam como contato feito). */
export const ANSWERED_OUTCOMES: CallOutcome[] = [
  "CALLBACK",
  "INTERESTED",
  "NOT_INTERESTED",
  "DO_NOT_CONTACT",
];

export interface CallInput {
  prospectId: number;
  outcome: CallOutcome;
  note?: string;
  /** Dias até tentar de novo (Não atendeu: 1; Ligar depois: 2). */
  retryInDays?: number;
}

/**
 * Registra o resultado de uma ligação feita por você e atualiza o funil.
 * Tudo fica no histórico; nada é inventado nem enviado.
 */
export async function recordCallOutcome(input: CallInput): Promise<void> {
  const prospect = await getProspectContextRepository(input.prospectId);

  if (!prospect) throw new Error("Prospect não encontrado.");

  const companyId = Number(prospect.company_id);
  const note = input.note?.trim() ?? "";

  if (await isCompanySuppressed(companyId)) {
    throw new Error("Esta empresa pediu para não ser contatada.");
  }

  await createActivityRepository(
    input.prospectId,
    "CALL",
    `${CALL_OUTCOME_LABEL[input.outcome]}${note ? `: ${note}` : ""}`,
    "PHONE",
    { outcome: input.outcome },
  );

  const open = (await listTasksByProspectRepository(input.prospectId)).filter(
    (t) => !t.completed_at && ["FIRST_CONTACT", "FOLLOW_UP"].includes(t.type),
  );

  const retry = async (days: number, title: string) => {
    if (open[0]) {
      await rescheduleTaskRepository(open[0].id, days);
    } else {
      await createTaskRepository(input.prospectId, "FOLLOW_UP", title, days);
    }
  };

  switch (input.outcome) {
    case "NO_ANSWER":
      await retry(input.retryInDays ?? 1, "Ligar novamente");
      break;

    case "WRONG_NUMBER":
      // O contato precisa ser conferido: mantém a tarefa para amanhã.
      await retry(input.retryInDays ?? 1, "Conferir o telefone e ligar");
      break;

    case "CALLBACK":
      if (prospect.status === "READY") {
        await changeProspectStatus(input.prospectId, "CONTACTED");
      }

      await retry(input.retryInDays ?? 2, "Ligar de volta (combinado)");
      break;

    case "INTERESTED": {
      const text = `[Ligação] ${note || "Atendeu e demonstrou interesse."}`;
      const conversation = await getOrCreateConversationRepository(companyId);

      await insertMessageRepository({
        conversationId: conversation.id,
        companyId,
        direction: "IN",
        author: "LEAD",
        body: text,
        status: "RECEIVED",
      });

      if (["READY", "CONTACTED", "NURTURE"].includes(prospect.status)) {
        await recordReply(input.prospectId, text);
      }

      break;
    }

    case "NOT_INTERESTED":
      await markLost(input.prospectId, "NO_NEED", note || "Sem interesse (ligação)");
      break;

    case "DO_NOT_CONTACT":
      await confirmOptOut(companyId, "Pediu para não ser contatado por ligação");
      break;
  }
}

/* ---------- retorno sobre os gargalos (mede a precisão do diagnóstico) ---------- */

export type BottleneckVerdict = "CONFIRMED" | "WRONG" | "UNKNOWN";

export async function saveBottleneckFeedback(
  companyId: number,
  bottleneck: AiBottleneck,
  verdict: BottleneckVerdict,
): Promise<void> {
  const analysis = await getLatestAnalysis(companyId);

  unwrap(
    await getSupabase()
      .from("bottleneck_feedback")
      .upsert(
        {
          company_id: companyId,
          analysis_id: analysis?.id ?? null,
          title: bottleneck.title,
          evidence: JSON.stringify(bottleneck.evidence),
          service_key: bottleneck.service_key,
          verdict,
        },
        { onConflict: "company_id,title" },
      ),
  );
}

export async function listBottleneckFeedback(
  companyId: number,
): Promise<Map<string, BottleneckVerdict>> {
  const rows = unwrap(
    await getSupabase()
      .from("bottleneck_feedback")
      .select("title,verdict")
      .eq("company_id", companyId),
  ) as { title: string; verdict: BottleneckVerdict }[];

  return new Map(rows.map((r) => [r.title, r.verdict]));
}

/* ---------- dossiê da ligação ---------- */

export interface CallDossier {
  companyId: number;
  bottlenecks: (AiBottleneck & { verdict: BottleneckVerdict | null })[];
  /** Ângulo sugerido pela IA para abrir a conversa. */
  opening: string | null;
  /** Contato principal por tipo (um por canal), para ligar ou abrir o WhatsApp. */
  contacts: StoredChannel[];
  hasDiagnosis: boolean;
  /**
   * O que confirmar na conversa sobre automação. "Não encontrado" e "não dá para saber"
   * entram como PERGUNTA: nunca como afirmação sobre a empresa.
   */
  automation: { area: string; state: AutomationState; stateLabel: string; found: string[]; question: string }[];
}

export async function loadCallDossier(companyId: number): Promise<CallDossier> {
  const [analysis, channels, feedback, presence] = await Promise.all([
    getLatestAnalysis(companyId),
    listChannelsRepository(companyId),
    listBottleneckFeedback(companyId),
    getPresence(companyId),
  ]);

  return {
    companyId,
    hasDiagnosis: !!analysis,
    opening: analysis?.outreach_angle ?? null,
    bottlenecks: parseBottlenecks(analysis).map((b) => ({
      ...b,
      verdict: feedback.get(b.title) ?? null,
    })),
    contacts: consolidateChannels(channels).main,
    automation: (presence?.report.automation?.areas ?? [])
      .filter((a) => a.state !== "NOT_APPLICABLE" && a.state !== "ALREADY")
      .map((a) => ({
        area: a.label,
        state: a.state,
        stateLabel: STATE_LABEL[a.state],
        found: a.evidence.map((e) => e.text),
        question: a.question,
      })),
  };
}
