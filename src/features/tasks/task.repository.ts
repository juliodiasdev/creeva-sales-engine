import {
  getDatabase,
} from "../../lib/database";

import type {
  Task,
  TaskType,
  TaskWithProspect,
} from "./task.types";

export async function createTaskRepository(
  prospectId: number,
  type: TaskType,
  title: string,
  dueInDays?: number,
): Promise<void> {
  const db = await getDatabase();

  // due_at usa datetime() do SQLite (UTC), mesmo formato de CURRENT_TIMESTAMP.
  await db.execute(
    `
      INSERT INTO tasks (
        prospect_id,
        type,
        title,
        due_at
      )

      VALUES (
        $1,
        $2,
        $3,
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

/**
 * Conclui a task somente se ainda estiver aberta.
 * Retorna false quando já havia sido concluída (evita duplo envio).
 */
export async function completeTaskRepository(
  taskId: number,
): Promise<boolean> {
  const db = await getDatabase();

  const result = await db.execute(
    `
      UPDATE tasks
      SET completed_at = datetime('now')
      WHERE id = $1
        AND completed_at IS NULL
    `,
    [taskId],
  );

  return result.rowsAffected > 0;
}

export async function listPendingTasksRepository():
Promise<TaskWithProspect[]> {
  const db = await getDatabase();

  return db.select<TaskWithProspect[]>(`
    SELECT
      t.*,

      c.name AS company_name,

      p.status AS prospect_status

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
      CASE
        WHEN t.priority = 'HIGH' THEN 1
        WHEN t.priority = 'NORMAL' THEN 2
        ELSE 3
      END,

      t.due_at ASC,

      t.id ASC
  `);
}