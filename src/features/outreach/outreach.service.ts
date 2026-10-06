import {
  completeTaskRepository,
  createTaskRepository,
  getTaskRepository,
} from "../tasks/task.repository";

import {
  createActivityRepository,
} from "../activities/activity.repository";

import {
  getProspectContextRepository,
  updateProspectWorkflowRepository,
} from "../prospects/prospect.repository";

import {
  buildOutreachMessage,
} from "./outreach.template";

import type {
  OutreachDraft,
} from "./outreach.types";

import {
  getNumberSetting,
} from "../settings/settings.service";

const OUTREACH_TASK_TYPES = [
  "FIRST_CONTACT",
  "FOLLOW_UP",
];

export async function prepareOutreach(
  taskId: number,
): Promise<OutreachDraft> {
  const task = await getTaskRepository(
    taskId,
  );

  if (!task || task.completed_at) {
    throw new Error(
      "Tarefa não encontrada ou já concluída.",
    );
  }

  if (!OUTREACH_TASK_TYPES.includes(task.type)) {
    throw new Error(
      "Esta tarefa não possui abordagem.",
    );
  }

  const prospect =
    await getProspectContextRepository(
      task.prospect_id,
    );

  if (!prospect) {
    throw new Error(
      "Prospect não encontrado.",
    );
  }

  return {
    taskId,
    prospectId: prospect.id,
    taskType: task.type,
    companyName: prospect.company_name,
    message: buildOutreachMessage({
      taskType: task.type,
      companyName: prospect.company_name,
      segment: prospect.segment,
      city: prospect.city,
    }),
  };
}

/**
 * Registra o envio manual de uma mensagem.
 *
 * FIRST_CONTACT: READY -> CONTACTED, cria FOLLOW_UP (D+2).
 * FOLLOW_UP: registra o envio sem alterar o estágio.
 *
 * Observação: tauri-plugin-sql usa pool de conexões, então
 * BEGIN/COMMIT em chamadas separadas não é confiável. A ordem
 * abaixo torna o fluxo seguro contra duplo clique (a conclusão
 * da task é o guard) e o primeiro passo é o que impede reexecução.
 */
export async function markTaskAsSent(
  taskId: number,
  message: string,
): Promise<void> {
  const content = message.trim();

  if (!content) {
    throw new Error(
      "A mensagem enviada não pode ficar vazia.",
    );
  }

  const task = await getTaskRepository(
    taskId,
  );

  if (!task) {
    throw new Error(
      "Tarefa não encontrada.",
    );
  }

  if (!OUTREACH_TASK_TYPES.includes(task.type)) {
    throw new Error(
      "Esta tarefa não é uma abordagem.",
    );
  }

  const prospect =
    await getProspectContextRepository(
      task.prospect_id,
    );

  if (!prospect) {
    throw new Error(
      "Prospect não encontrado.",
    );
  }

  const completed =
    await completeTaskRepository(taskId);

  if (!completed) {
    throw new Error(
      "Esta tarefa já foi concluída.",
    );
  }

  await createActivityRepository(
    prospect.id,
    "MESSAGE_SENT",
    content,
    "MANUAL",
  );

  if (task.type === "FIRST_CONTACT") {
    const FOLLOW_UP_DELAY_DAYS = await getNumberSetting(
      "follow_up_delay_days",
      2,
    );

    await createTaskRepository(
      prospect.id,
      "FOLLOW_UP",
      "Fazer follow-up",
      FOLLOW_UP_DELAY_DAYS,
    );

    await updateProspectWorkflowRepository(
      prospect.id,
      {
        status:
          prospect.status === "READY"
            ? "CONTACTED"
            : undefined,
        nextAction: "Fazer follow-up",
        nextActionInDays:
          FOLLOW_UP_DELAY_DAYS,
      },
    );
  }
}
