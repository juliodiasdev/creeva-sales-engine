import type { ProspectStatus } from "./prospect.types";

export const STATUS_LABEL: Record<ProspectStatus, string> = {
  READY: "Pronto",
  CONTACTED: "Contatado",
  REPLIED: "Respondeu",
  MEETING: "Reunião",
  PROPOSAL: "Proposta",
  WON: "Ganho",
  LOST: "Perdido",
  NURTURE: "Nutrição",
  DISQUALIFIED: "Desqualificado",
  DO_NOT_CONTACT: "Não contatar",
};

export const PIPELINE_COLUMNS: ProspectStatus[] = [
  "READY",
  "CONTACTED",
  "REPLIED",
  "MEETING",
  "PROPOSAL",
  "WON",
];

export const OTHER_STATUSES: ProspectStatus[] = [
  "LOST",
  "NURTURE",
  "DISQUALIFIED",
  "DO_NOT_CONTACT",
];

export const ALL_STATUSES: ProspectStatus[] = [
  ...PIPELINE_COLUMNS,
  ...OTHER_STATUSES,
];

export const ACTIVITY_LABEL: Record<string, string> = {
  PROSPECT_CREATED: "Prospect criado",
  MESSAGE_SENT: "Mensagem enviada",
  REPLY_RECEIVED: "Resposta recebida",
  FOLLOW_UP: "Follow-up",
  CALL: "Ligação",
  MEETING: "Reunião",
  PROPOSAL_SENT: "Proposta enviada",
  STATUS_CHANGED: "Mudança de estágio",
  WON: "Ganho",
  LOST: "Perdido",
};
