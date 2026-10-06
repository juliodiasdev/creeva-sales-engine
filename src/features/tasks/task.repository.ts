import {
  getDatabase,
} from "../../lib/database";

import type {
  TaskType,
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