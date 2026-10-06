import {
  getDatabase,
} from "../../lib/database";

import type {
  Activity,
  ActivityType,
} from "./activity.types";

export async function createActivityRepository(
  prospectId: number,
  type: ActivityType,
  content?: string,
  channel?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO activities (
        prospect_id,
        type,
        content,
        channel,
        metadata
      )

      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      prospectId,
      type,
      content ?? null,
      channel ?? null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

export async function listActivitiesRepository(
  prospectId: number,
  limit = 200,
): Promise<Activity[]> {
  const db = await getDatabase();

  // id como desempate: occurred_at tem resolução de 1 segundo.
  return db.select<Activity[]>(
    `
      SELECT *
      FROM activities
      WHERE prospect_id = $1
      ORDER BY occurred_at ASC, id ASC
      LIMIT $2
    `,
    [prospectId, limit],
  );
}
