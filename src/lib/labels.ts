/** Nomes em português simples para tudo que o usuário vê. */

export const TASK_TYPE_LABEL: Record<string, string> = {
  FIRST_CONTACT: "Primeiro contato",
  FOLLOW_UP: "Retorno (follow-up)",
  CALL: "Ligação",
  MEETING: "Reunião",
  PROPOSAL: "Proposta",
  OTHER: "Outra tarefa",
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  DISCOVERED: "Nova",
  ENRICHING: "Enriquecendo…",
  ENRICHED: "Enriquecida",
  QUALIFIED: "Qualificada",
  READY: "Em abordagem",
  DISQUALIFIED: "Descartada",
};

export const JOB_TYPE_LABEL: Record<string, string> = {
  DISCOVERY: "Busca de empresas",
  ENRICHMENT: "Enriquecimento",
};

export const JOB_STATUS_LABEL: Record<string, string> = {
  PENDING: "Na fila",
  RUNNING: "Em andamento",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};

export const PRIORITY_LABEL: Record<string, string> = {
  HIGH: "Alta",
  NORMAL: "Normal",
  LOW: "Baixa",
};

export const DEAL_STATUS_LABEL: Record<string, string> = {
  OPEN: "Em aberto",
  WON: "Ganho",
  LOST: "Perdido",
};

export const TASK_OUTCOME_LABEL: Record<string, string> = {
  DONE: "Concluída",
  SKIPPED: "Pulada",
  CANCELED: "Cancelada",
};

export const LOST_REASON_LABEL: Record<string, string> = {
  PRICE: "Preço",
  NO_RESPONSE: "Sem resposta",
  NO_NEED: "Sem necessidade",
  COMPETITOR: "Foi para a concorrência",
  TIMING: "Momento errado",
  INTERNAL: "Decisão interna",
  OTHER: "Outro motivo",
};

export const SOURCE_LABEL: Record<string, string> = {
  GOOGLE_PLACES: "Google",
  WEBSITE: "Site da empresa",
  MANUAL: "Cadastro manual",
  CNPJ: "CNPJ",
};

export const SIGNAL_LABEL: Record<string, string> = {
  NO_WEBSITE: "Sem site",
  NO_HTTPS: "Site sem cadeado (HTTPS)",
  NO_WHATSAPP: "Sem WhatsApp no site",
  NO_CLEAR_CTA: "Sem botão de ação claro",
  NO_FORM: "Sem formulário de contato",
  OUTDATED_COPYRIGHT: "Site desatualizado",
  LOW_REVIEWS: "Poucas avaliações",
  BROKEN_LINK: "Site fora do ar",
  WEAK_CONVERSION_PATH: "Caminho até o contato fraco",
  NO_MOBILE_SIGNAL: "Pode não funcionar bem no celular",
};

export const SCORE_DIMENSION_LABEL: Record<string, string> = {
  FIT: "Aderência",
  NEED: "Necessidade",
  CAPACITY: "Capacidade",
  INTENT: "Interesse",
};

export const PLAYBOOK_KIND_LABEL: Record<string, string> = {
  FIRST_CONTACT: "Primeiro contato",
  FOLLOW_UP_1: "Retorno 1",
  FOLLOW_UP_2: "Retorno 2",
  PROPOSAL_FOLLOW_UP: "Retorno da proposta",
  REACTIVATION: "Reativação",
};

/** Troca códigos como "NO_WEBSITE: texto" por "Sem site: texto". */
export function humanizeReason(text: string): string {
  return text.replace(/^([A-Z_]+): /, (match, code: string) =>
    SIGNAL_LABEL[code] ? `${SIGNAL_LABEL[code]}: ` : match,
  );
}

export const label = (
  map: Record<string, string>,
  key: string | null | undefined,
): string => (key ? (map[key] ?? key) : "—");
