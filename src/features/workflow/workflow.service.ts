import { isCompanySuppressed, suppressCompany } from "../compliance/suppression.service";
import {
  getProspectContextRepository,
  updateProspectWorkflowRepository,
} from "../prospects/prospect.repository";

import type {
  ProspectStatus,
  ProspectWithCompany,
} from "../prospects/prospect.types";

import {
  cancelOpenTasksRepository,
  completeTaskRepository,
  createTaskRepository,
  getTaskRepository,
  rescheduleTaskRepository,
} from "../tasks/task.repository";

import {
  createActivityRepository,
} from "../activities/activity.repository";

import {
  closeDealRepository,
  createDealRepository,
  createMeetingRepository,
  createProposalRepository,
  getOpenDealRepository,
  updateOpenDealValueRepository,
} from "../deals/deal.repository";

import { LOST_REASONS } from "../deals/deal.types";
import type { LostReason } from "../deals/deal.types";

import {
  getNumberSetting,
} from "../settings/settings.service";

/** Estágios que exigem dados próprios (formulário dedicado). */
export const GUARDED_STATUSES: ProspectStatus[] = [
  "MEETING",
  "PROPOSAL",
  "WON",
  "LOST",
];

const CLOSED: ProspectStatus[] = [
  "WON",
  "LOST",
  "DISQUALIFIED",
  "DO_NOT_CONTACT",
];

async function requireProspect(
  prospectId: number,
): Promise<ProspectWithCompany> {
  const prospect =
    await getProspectContextRepository(prospectId);

  if (!prospect) {
    throw new Error("Prospect não encontrado.");
  }

  return prospect;
}

async function logStatusChange(
  prospect: ProspectWithCompany,
  to: ProspectStatus,
  note?: string,
) {
  if (prospect.status === to) return;

  await createActivityRepository(
    prospect.id,
    "STATUS_CHANGED",
    `Estágio alterado: ${prospect.status} → ${to}`,
    undefined,
    { from: prospect.status, to, note },
  );
}

/**
 * Mudança simples de estágio (sem dados extras) + Activity.
 * WON/LOST/MEETING/PROPOSAL têm funções próprias.
 */
export async function changeProspectStatus(
  prospectId: number,
  to: ProspectStatus,
): Promise<void> {
  if (GUARDED_STATUSES.includes(to)) {
    throw new Error(
      `O estágio ${to} exige registrar os dados correspondentes.`,
    );
  }

  const prospect = await requireProspect(prospectId);

  if (prospect.status === to) return;

  // "Não contatar" é permanente: só sai por "Foi engano: desfazer" em Conversas.
  if (
    prospect.status === "DO_NOT_CONTACT" &&
    (await isCompanySuppressed(Number(prospect.company_id)))
  ) {
    throw new Error(
      'Esta empresa está na lista de supressão. Use "Foi engano: desfazer" em Conversas para reabrir.',
    );
  }

  if (to === "DO_NOT_CONTACT") {
    await suppressCompany(
      Number(prospect.company_id),
      "Marcada manualmente como não contatar",
    );
  }

  const closes = CLOSED.includes(to);

  await logStatusChange(prospect, to);

  if (closes || to === "NURTURE") {
    await cancelOpenTasksRepository(prospectId);
  }

  // Reabertura de um prospect fechado volta a exigir ação.
  if (to === "READY" && CLOSED.includes(prospect.status)) {
    await createTaskRepository(
      prospectId,
      "FIRST_CONTACT",
      "Realizar primeiro contato",
    );
  }

  await updateProspectWorkflowRepository(prospectId, {
    status: to,
    nextAction:
      to === "READY"
        ? "Realizar primeiro contato"
        : null,
    closed: CLOSED.includes(to) ? true : false,
    lostReason: null,
  });
}

/** Resposta recebida: para follow-ups e abre o próximo passo. */
export async function recordReply(
  prospectId: number,
  content: string,
): Promise<void> {
  const text = content.trim();

  if (!text) {
    throw new Error("Descreva a resposta recebida.");
  }

  const prospect = await requireProspect(prospectId);

  await createActivityRepository(
    prospectId,
    "REPLY_RECEIVED",
    text,
    "MANUAL",
  );

  await logStatusChange(prospect, "REPLIED");

  await cancelOpenTasksRepository(prospectId, [
    "FIRST_CONTACT",
    "FOLLOW_UP",
  ]);

  await createTaskRepository(
    prospectId,
    "MEETING",
    "Responder e agendar reunião",
    0,
    "HIGH",
  );

  await updateProspectWorkflowRepository(prospectId, {
    status: "REPLIED",
    nextAction: "Responder e agendar reunião",
    nextActionInDays: 0,
    closed: false,
  });
}

export interface MeetingInput {
  scheduledAt: string;
  notes?: string;
  need?: string;
  budget?: string;
  decisionMaker?: string;
  timeline?: string;
}

export async function recordMeeting(
  prospectId: number,
  input: MeetingInput,
): Promise<void> {
  if (!input.scheduledAt) {
    throw new Error("Informe a data da reunião.");
  }

  const prospect = await requireProspect(prospectId);

  await createMeetingRepository({
    prospectId,
    ...input,
  });

  await createActivityRepository(
    prospectId,
    "MEETING",
    input.notes || "Reunião registrada.",
    "MANUAL",
    {
      scheduledAt: input.scheduledAt,
      need: input.need,
      budget: input.budget,
      decisionMaker: input.decisionMaker,
      timeline: input.timeline,
    },
  );

  await logStatusChange(prospect, "MEETING");

  await cancelOpenTasksRepository(prospectId, [
    "FIRST_CONTACT",
    "FOLLOW_UP",
    "MEETING",
  ]);

  await createTaskRepository(
    prospectId,
    "PROPOSAL",
    "Preparar e enviar proposta",
    1,
  );

  await updateProspectWorkflowRepository(prospectId, {
    status: "MEETING",
    nextAction: "Preparar e enviar proposta",
    nextActionInDays: 1,
    closed: false,
  });
}

export interface ProposalInput {
  value: number;
  description?: string;
  serviceType?: string;
  validDays?: number;
}

export async function sendProposal(
  prospectId: number,
  input: ProposalInput,
): Promise<void> {
  if (!(input.value > 0)) {
    throw new Error("Informe o valor da proposta.");
  }

  const prospect = await requireProspect(prospectId);

  let deal = await getOpenDealRepository(prospectId);

  const dealId = deal
    ? deal.id
    : await createDealRepository({
        prospectId,
        title: `${input.serviceType || "Projeto"} — ${prospect.company_name}`,
        serviceType: input.serviceType,
        value: input.value,
        expectedCloseInDays:
          input.validDays ?? 15,
      });

  if (deal) {
    await updateOpenDealValueRepository(
      deal.id,
      input.value,
      input.serviceType,
    );
  }

  await createProposalRepository({
    dealId,
    prospectId,
    value: input.value,
    description: input.description,
    validDays: input.validDays,
  });

  await createActivityRepository(
    prospectId,
    "PROPOSAL_SENT",
    input.description || "Proposta enviada.",
    "MANUAL",
    { value: input.value, dealId },
  );

  await logStatusChange(prospect, "PROPOSAL");

  await cancelOpenTasksRepository(prospectId, [
    "PROPOSAL",
    "FOLLOW_UP",
  ]);

  const PROPOSAL_FOLLOW_UP_DAYS = await getNumberSetting(
    "proposal_follow_up_days",
    3,
  );

  await createTaskRepository(
    prospectId,
    "FOLLOW_UP",
    "Follow-up da proposta",
    PROPOSAL_FOLLOW_UP_DAYS,
    "HIGH",
  );

  await updateProspectWorkflowRepository(prospectId, {
    status: "PROPOSAL",
    nextAction: "Follow-up da proposta",
    nextActionInDays: PROPOSAL_FOLLOW_UP_DAYS,
    closed: false,
  });
}

export interface WonInput {
  value: number;
  serviceType?: string;
  recurring?: boolean;
}

export async function markWon(
  prospectId: number,
  input: WonInput,
): Promise<void> {
  if (!(input.value > 0)) {
    throw new Error("Informe o valor final fechado.");
  }

  const prospect = await requireProspect(prospectId);

  const open = await getOpenDealRepository(prospectId);

  const dealId = open
    ? open.id
    : await createDealRepository({
        prospectId,
        title: `${input.serviceType || "Projeto"} — ${prospect.company_name}`,
        serviceType: input.serviceType,
        value: input.value,
      });

  await closeDealRepository(dealId, "WON", input);

  await createActivityRepository(
    prospectId,
    "WON",
    `Negócio fechado: R$ ${input.value.toFixed(2)}`,
    undefined,
    { value: input.value, serviceType: input.serviceType, recurring: !!input.recurring, dealId },
  );

  await logStatusChange(prospect, "WON");

  await cancelOpenTasksRepository(prospectId);

  await updateProspectWorkflowRepository(prospectId, {
    status: "WON",
    nextAction: null,
    closed: true,
    lostReason: null,
  });
}

export async function markLost(
  prospectId: number,
  reason: LostReason,
  notes?: string,
): Promise<void> {
  if (!LOST_REASONS.includes(reason)) {
    throw new Error("Informe o motivo da perda.");
  }

  const prospect = await requireProspect(prospectId);

  const open = await getOpenDealRepository(prospectId);

  if (open) {
    await closeDealRepository(open.id, "LOST", {
      lostReason: reason,
    });
  }

  await createActivityRepository(
    prospectId,
    "LOST",
    notes?.trim() || `Perdido: ${reason}`,
    undefined,
    { reason },
  );

  await logStatusChange(prospect, "LOST");

  await cancelOpenTasksRepository(prospectId);

  await updateProspectWorkflowRepository(prospectId, {
    status: "LOST",
    nextAction: null,
    closed: true,
    lostReason: reason,
  });
}

/* ---------- Tasks do Today ---------- */

export async function completeTask(
  taskId: number,
): Promise<void> {
  const task = await getTaskRepository(taskId);

  if (!task) throw new Error("Tarefa não encontrada.");

  const done = await completeTaskRepository(
    taskId,
    "DONE",
  );

  if (!done) throw new Error("Esta tarefa já foi concluída.");

  if (task.type === "CALL") {
    await createActivityRepository(
      task.prospect_id,
      "CALL",
      task.title,
      "PHONE",
    );
  }
}

export async function skipTask(
  taskId: number,
): Promise<void> {
  const done = await completeTaskRepository(
    taskId,
    "SKIPPED",
  );

  if (!done) throw new Error("Esta tarefa já foi fechada.");
}

export async function rescheduleTask(
  taskId: number,
  days: number,
): Promise<void> {
  if (!(days >= 1)) {
    throw new Error("Escolha ao menos 1 dia.");
  }

  const ok = await rescheduleTaskRepository(
    taskId,
    days,
  );

  if (!ok) throw new Error("Tarefa não encontrada ou já fechada.");
}
