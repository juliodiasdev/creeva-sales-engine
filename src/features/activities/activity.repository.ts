import {
  getDatabase,
} from "../../lib/database";

import type {
  ActivityType,
} from "./activity.types";

export async function createActivityRepository(
  prospectId: number,
  type: ActivityType,
  content?: string,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO activities (
        prospect_id,
        type,
        content
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
      content ?? null,
    ],
  );
}