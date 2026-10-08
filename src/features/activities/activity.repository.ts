import { getSupabase, unwrap } from "../../lib/store";

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
  unwrap(
    await getSupabase()
      .from("activities")
      .insert({
        prospect_id: prospectId,
        type,
        content: content ?? null,
        channel: channel ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      }),
  );
}

export async function listActivitiesRepository(
  prospectId: number,
  limit = 200,
): Promise<Activity[]> {
  // id como desempate: occurred_at pode empatar.
  return unwrap(
    await getSupabase()
      .from("activities")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit),
  ) as Activity[];
}
