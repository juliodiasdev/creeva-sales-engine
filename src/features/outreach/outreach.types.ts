import type {
  TaskType,
} from "../tasks/task.types";

import type { StoredChannel } from "../contacts/channels.repository";

export interface OutreachDraft {
  taskId: number;

  prospectId: number;

  taskType: TaskType;

  companyName: string;

  message: string;

  /** Canais reais da empresa (abrir WhatsApp/redes com a mensagem). */
  channels: StoredChannel[];
}
