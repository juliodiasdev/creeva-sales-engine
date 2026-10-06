export type ActivityType =
  | "PROSPECT_CREATED"
  | "MESSAGE_SENT"
  | "REPLY_RECEIVED"
  | "FOLLOW_UP"
  | "CALL"
  | "MEETING"
  | "PROPOSAL_SENT"
  | "STATUS_CHANGED"
  | "WON"
  | "LOST";

export interface Activity {
  id: number;

  prospect_id: number;

  type: ActivityType;

  channel: string | null;

  content: string | null;

  metadata: string | null;

  occurred_at: string;
}