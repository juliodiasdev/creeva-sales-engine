export type TaskPriority =
  | "LOW"
  | "NORMAL"
  | "HIGH";

export type TaskType =
  | "FIRST_CONTACT"
  | "FOLLOW_UP"
  | "CALL"
  | "MEETING"
  | "PROPOSAL"
  | "OTHER";

export type TaskOutcome =
  | "DONE"
  | "SKIPPED"
  | "CANCELED";

export interface Task {
  id: number;

  prospect_id: number;

  type: TaskType;

  title: string;
  description: string | null;

  priority: TaskPriority;

  due_at: string | null;
  completed_at: string | null;
  outcome: TaskOutcome | null;

  created_at: string;
}

export interface TaskWithProspect
  extends Task {
  company_name: string;

  prospect_status: string;

  prospect_score: number;

  /** 1 quando due_at é de um dia anterior ao de hoje. */
  is_overdue: number;
}
