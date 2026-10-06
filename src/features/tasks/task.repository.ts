import {
  getDatabase,
} from "../../lib/database";

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
  const db = await getDatabase();

  // due_at usa datetime() do SQLite (UTC), mesmo formato de CURRENT_TIMESTAMP.
  await db.execute(
    `
      INSERT INTO tasks (
        prospect_id,
        type,
        title,
        priority,
        due_at
      )

      VALUES (
        $1,
        $2,
        $3,
        $5,
        CASE
          WHEN $4 IS NULL THEN NULL
          ELSE datetime('now', '+' || $4 || ' days')
        END
      )
    `,
    [
      prospectId,
      type,
      title,
      dueInDays ?? null,
      priority,
    ],
  );
}

export async function getTaskRepository(
  taskId: number,
): Promise<Task | null> {
  const db = await getDatabase();

  const rows = await db.select<Task[]>(
    `SELECT * FROM tasks WHERE id = $1`,
    [taskId],
  );

  return rows[0] ?? null;
}

export async function listTasksByProspectRepository(
  prospectId: number,
): Promise<Task[]> {
  const db = await getDatabase();

  return db.select<Task[]>(
    `
      SELECT *
      FROM tasks
      WHERE prospect_id = $1
      ORDER BY
        completed_at IS NOT NULL,
        due_at ASC,
        id ASC
    `,
    [prospectId],
  );
}

/**
 * Fecha a task somente se ainda estiver aberta.
 * Retorna false quando já havia sido fechada (evita duplo envio).
 */
export async function completeTaskRepository(
  taskId: number,
  outcome: TaskOutcome = "DONE",
): Promise<boolean> {
  const db = await getDatabase();

  const result = await db.execute(
    `
      UPDATE tasks
      SET completed_at = datetime('now'),
          outcome = $2
      WHERE id = $1
        AND completed_at IS NULL
    `,
    [taskId, outcome],
  );

  return result.rowsAffected > 0;
}

/** Cancela tasks abertas do prospect (ex.: respondeu, ganhou, perdeu). */
export async function cancelOpenTasksRepository(
  prospectId: number,
  types?: TaskType[],
): Promise<void> {
  const db = await getDatabase();

  const filter = types?.length
    ? `AND type IN (${types
        .map((_, i) => `$${i + 2}`)
        .join(", ")})`
    : "";

  await db.execute(
    `
      UPDATE tasks
      SET completed_at = datetime('now'),
          outcome = 'CANCELED'
      WHERE prospect_id = $1
        AND completed_at IS NULL
        ${filter}
    `,
    [prospectId, ...(types ?? [])],
  );
}

export async function rescheduleTaskRepository(
  taskId: number,
  days: number,
): Promise<boolean> {
  const db = await getDatabase();

  const result = await db.execute(
    `
      UPDATE tasks
      SET due_at = datetime('now', '+' || $2 || ' days')
      WHERE id = $1
        AND completed_at IS NULL
    `,
    [taskId, days],
  );

  return result.rowsAffected > 0;
}

/**
 * Today: abertas, sem data ou já vencidas.
 * Ordem: atrasadas, prioridade, score, mais antigas.
 */
export async function listPendingTasksRepository():
Promise<TaskWithProspect[]> {
  const db = await getDatabase();

  return db.select<TaskWithProspect[]>(`
    SELECT
      t.*,

      c.name AS company_name,

      p.status AS prospect_status,

      p.score AS prospect_score,

      CASE
        WHEN t.due_at IS NOT NULL
         AND date(t.due_at) < date('now')
        THEN 1 ELSE 0
      END AS is_overdue

    FROM tasks t

    INNER JOIN prospects p
      ON p.id = t.prospect_id

    INNER JOIN companies c
      ON c.id = p.company_id

    WHERE t.completed_at IS NULL
      AND (
        t.due_at IS NULL
        OR t.due_at <= datetime('now')
      )

    ORDER BY
      is_overdue DESC,

      CASE
        WHEN t.priority = 'HIGH' THEN 1
        WHEN t.priority = 'NORMAL' THEN 2
        ELSE 3
      END,

      p.score DESC,

      t.created_at ASC,

      t.id ASC
  `);
}
