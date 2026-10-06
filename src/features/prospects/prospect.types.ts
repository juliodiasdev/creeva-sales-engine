export type ProspectStatus =
  | "READY"
  | "CONTACTED"
  | "REPLIED"
  | "MEETING"
  | "PROPOSAL"
  | "WON"
  | "LOST"
  | "NURTURE"
  | "DISQUALIFIED"
  | "DO_NOT_CONTACT";

export type ProspectPriority =
  | "LOW"
  | "NORMAL"
  | "HIGH";

export interface Prospect {
  id: number;

  company_id: number;

  status: ProspectStatus;

  priority: ProspectPriority;

  score: number;

  next_action: string | null;
  next_action_at: string | null;

  qualification_notes: string | null;

  created_at: string;
  updated_at: string;
}

export interface ProspectWithCompany extends Prospect {
  company_name: string;
  segment: string | null;
  city: string | null;
  state: string | null;
}