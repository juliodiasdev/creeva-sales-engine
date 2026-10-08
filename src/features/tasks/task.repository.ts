import {
  fetchAllPages,
  fetchByIds,
  getSupabase,
  inDaysIso,
  nowIso,
  startOfTodayIso,
  unwrap,
} from "../../lib/store";

import type {
  Task,
  TaskOutcome,
  TaskPriority,
  TaskType,
  TaskWithProspect,
} from "./task.types";

export async function createTaskRepository(
  prospectId: number,
  type: TaskType,
  title: string,
  dueInDays?: number,
  priority: TaskPriority = "NORMAL",
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("tasks")
      .insert({
        prospect_id: prospectId,
        type,
        title,
        priority,
        due_at:
          dueInDays === undefined ? null : inDaysIso(dueInDays),
      }),
  );
}

export async function getTaskRepository(
  taskId: number,
): Promise<Task | null> {
  return unwrap(
    await getSupabase()
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .maybeSingle(),
  ) as Task | null;
}

export async function listTasksByProspectRepository(
  prospectId: number,
): Promise<Task[]> {
  const tasks = unwrap(
    await getSupabase()
      .from("tasks")
      .select("*")
      .eq("prospect_id", prospectId),
  ) as Task[];

  // Abertas primeiro, depois por vencimento e id.
  return tasks.sort((a, b) => {
    const open = Number(!!a.completed_at) - Number(!!b.completed_at);
    if (open) return open;
    return (
      (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") ||
      a.id - b.id
    );
  });
}

/**
 * Fecha a task somente se ainda estiver aberta.
 * Retorna false quando já havia sido fechada (evita duplo envio).
 */
export async function completeTaskRepository(
  taskId: number,
  outcome: TaskOutcome = "DONE",
): Promise<boolean> {
  const rows = unwrap(
    await getSupabase()
      .from("tasks")
      .update({ completed_at: nowIso(), outcome })
      .eq("id", taskId)
      .is("completed_at", null)
      .select("id"),
  ) as { id: number }[];

  return rows.length > 0;
}

/** Cancela tasks abertas do prospect (ex.: respondeu, ganhou, perdeu). */
export async function cancelOpenTasksRepository(
  prospectId: number,
  types?: TaskType[],
): Promise<void> {
  let query = getSupabase()
    .from("tasks")
    .update({ completed_at: nowIso(), outcome: "CANCELED" })
    .eq("prospect_id", prospectId)
    .is("completed_at", null);

  if (types?.length) query = query.in("type", types);

  unwrap(await query);
}

export async function rescheduleTaskRepository(
  taskId: number,
  days: number,
): Promise<boolean> {
  const rows = unwrap(
    await getSupabase()
      .from("tasks")
      .update({ due_at: inDaysIso(days) })
      .eq("id", taskId)
      .is("completed_at", null)
      .select("id"),
  ) as { id: number }[];

  return rows.length > 0;
}

const PRIORITY_RANK: Record<string, number> = {
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

/**
 * Today: abertas, sem data ou já vencidas.
 * Ordem: atrasadas, prioridade, score, mais antigas.
 */
export async function listPendingTasksRepository(): Promise<
  TaskWithProspect[]
> {
  const now = nowIso();

  const tasks = await fetchAllPages<Task>((from, to) =>
    getSupabase()
      .from("tasks")
      .select("*")
      .is("completed_at", null)
      .or(`due_at.is.null,due_at.lte.${now}`)
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  if (tasks.length === 0) return [];

  const prospects = await fetchByIds<{
    id: number;
    company_id: number;
    status: string;
    score: number;
  }>(
    "prospects",
    "id,company_id,status,score",
    "id",
    tasks.map((t) => Number(t.prospect_id)),
  );

  const companies = await fetchByIds<{ id: number; name: string }>(
    "companies",
    "id,name",
    "id",
    prospects.map((p) => Number(p.company_id)),
  );

  const prospectById = new Map(prospects.map((p) => [Number(p.id), p]));
  const companyById = new Map(companies.map((c) => [Number(c.id), c]));
  const todayStart = startOfTodayIso();

  return tasks
    .flatMap((t): TaskWithProspect[] => {
      const prospect = prospectById.get(Number(t.prospect_id));

      if (!prospect) return [];

      return [
        {
          ...t,
          company_name:
            companyById.get(Number(prospect.company_id))?.name ?? "—",
          prospect_status: prospect.status,
          prospect_score: Number(prospect.score),
          is_overdue: t.due_at && t.due_at < todayStart ? 1 : 0,
        },
      ];
    })
    .sort(
      (a, b) =>
        b.is_overdue - a.is_overdue ||
        (PRIORITY_RANK[a.priority] ?? 3) -
          (PRIORITY_RANK[b.priority] ?? 3) ||
        b.prospect_score - a.prospect_score ||
        a.created_at.localeCompare(b.created_at) ||
        a.id - b.id,
    );
}
