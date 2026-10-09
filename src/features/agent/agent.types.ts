export type MessageDirection = "IN" | "OUT";
export type MessageAuthor = "LEAD" | "HUMAN" | "AI";
export type MessageStatus = "RECEIVED" | "DRAFT" | "SENT" | "DISCARDED";
export type DraftIntent = "CONTINUE" | "BOOK_MEETING" | "HANDOFF" | "CLOSE";

export const DRAFT_INTENTS: DraftIntent[] = [
  "CONTINUE",
  "BOOK_MEETING",
  "HANDOFF",
  "CLOSE",
];

export interface Conversation {
  id: number;
  company_id: number;
  opted_out: number;
  handoff_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: number;
  conversation_id: number;
  company_id: number;
  direction: MessageDirection;
  author: MessageAuthor;
  body: string;
  status: MessageStatus;
  intent: DraftIntent | null;
  model: string | null;
  edited: number;
  evidence_used: string | null;
  created_at: string;
}
