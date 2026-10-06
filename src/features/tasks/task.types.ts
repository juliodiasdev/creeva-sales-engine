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

export interface Task {
  id: number;

  prospect_id: number;

  type: TaskType;

  title: string;
  description: string | null;

  priority: TaskPriority;

  due_at: string | null;
  completed_at: string | null;

  created_at: string;
}