export type DealStatus = "OPEN" | "WON" | "LOST";

export type LostReason =
  | "PRICE"
  | "NO_RESPONSE"
  | "NO_NEED"
  | "COMPETITOR"
  | "TIMING"
  | "INTERNAL"
  | "OTHER";

export const LOST_REASONS: LostReason[] = [
  "PRICE",
  "NO_RESPONSE",
  "NO_NEED",
  "COMPETITOR",
  "TIMING",
  "INTERNAL",
  "OTHER",
];

export interface Deal {
  id: number;
  prospect_id: number;
  service_type: string | null;
  title: string;
  value: number;
  probability: number;
  status: DealStatus;
  expected_close_at: string | null;
  closed_at: string | null;
  recurring: number;
  lost_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Meeting {
  id: number;
  prospect_id: number;
  scheduled_at: string;
  notes: string | null;
  need: string | null;
  budget: string | null;
  decision_maker: string | null;
  timeline: string | null;
  created_at: string;
}

export interface Proposal {
  id: number;
  deal_id: number;
  prospect_id: number;
  value: number;
  description: string | null;
  sent_at: string;
  valid_until: string | null;
  created_at: string;
}
