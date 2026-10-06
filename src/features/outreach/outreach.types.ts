import type {
  TaskType,
} from "../tasks/task.types";

export interface OutreachDraft {
  taskId: number;

  prospectId: number;

  taskType: TaskType;

  companyName: string;

  message: string;
}
