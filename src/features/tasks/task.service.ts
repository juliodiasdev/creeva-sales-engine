import {
  listPendingTasksRepository,
} from "./task.repository";

export function listPendingTasks() {
  return listPendingTasksRepository();
}