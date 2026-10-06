import { listPendingTasks } from "../tasks/task.service";
import type { TaskWithProspect } from "../tasks/task.types";

import {
  getLatestScoreRepository,
  listSignalsRepository,
} from "../enrichment/enrichment.repository";
import type { StoredSignal } from "../enrichment/enrichment.repository";

import { getLatestAnalysis } from "../ai/ai.service";
import type { StoredAnalysis } from "../ai/ai.service";

import { getProspectContextRepository } from "../prospects/prospect.repository";

import { prepareOutreach } from "./outreach.service";
import type { OutreachDraft } from "./outreach.types";

export interface SessionItem {
  task: TaskWithProspect;
  draft: OutreachDraft;
  score: number | null;
  signals: StoredSignal[];
  analysis: StoredAnalysis | null;
}

/** Próximo prospect da fila de abordagens (mesma ordem do Today). */
export async function loadNextSessionItem(
  skipTaskIds: number[] = [],
): Promise<SessionItem | null> {
  const tasks = (await listPendingTasks()).filter(
    (t) =>
      (t.type === "FIRST_CONTACT" || t.type === "FOLLOW_UP") &&
      !skipTaskIds.includes(t.id),
  );

  const task = tasks[0];

  if (!task) return null;

  const prospect = await getProspectContextRepository(task.prospect_id);

  if (!prospect) return null;

  const [draft, score, signals, analysis] = await Promise.all([
    prepareOutreach(task.id),
    getLatestScoreRepository(prospect.company_id),
    listSignalsRepository(prospect.company_id),
    getLatestAnalysis(prospect.company_id),
  ]);

  return {
    task,
    draft,
    score: score?.total ?? null,
    signals,
    analysis,
  };
}
