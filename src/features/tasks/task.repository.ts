import {
  getDatabase,
} from "../../lib/database";

import type {
  TaskType,
  TaskWithProspect,
} from "./task.types";

export async function createTaskRepository(
  prospectId: number,
  type: TaskType,
  title: string,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO tasks (
        prospect_id,
        type,
        title
      )

      VALUES (
        $1,
        $2,
        $3
      )
    `,
    [
      prospectId,
      type,
      title,
    ],
  );
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

    ORDER BY
      CASE
        WHEN t.priority = 'HIGH' THEN 1
        WHEN t.priority = 'NORMAL' THEN 2
        ELSE 3
      END,

      t.id ASC
  `);
}