export interface AiAnalysisResult {
  summary: string;
  main_problem: string;
  opportunity: string;
  recommended_offer: string;
  outreach_angle: string;
  confidence: number;
}

const TEXT_FIELDS = [
  "summary",
  "main_problem",
  "opportunity",
  "recommended_offer",
  "outreach_angle",
] as const;

const MAX_TEXT = 1200;

/** Valida a resposta da IA antes de salvar; nunca confia no formato. */
export function validateAnalysis(raw: unknown): AiAnalysisResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Resposta da IA inválida.");
  }

  const obj = raw as Record<string, unknown>;
  const result: Partial<AiAnalysisResult> = {};

  for (const field of TEXT_FIELDS) {
    const value = obj[field];

    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Resposta da IA sem o campo "${field}".`);
    }

    result[field] = value.trim().slice(0, MAX_TEXT);
  }

  const confidence = Number(obj.confidence);

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Confiança da IA fora de 0–1.");
  }

  result.confidence = confidence;

  return result as AiAnalysisResult;
}

export interface AiOutreachResult {
  message: string;
  evidence_used: string[];
}

/**
 * A mensagem só pode citar evidências que existem como signals.
 * Se a IA declarar evidência inexistente, a resposta é rejeitada.
 */
export function validateOutreach(
  raw: unknown,
  allowedSignalTypes: string[],
): AiOutreachResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Resposta da IA inválida.");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.message !== "string" || !obj.message.trim()) {
    throw new Error("A IA não retornou mensagem.");
  }

  const used = Array.isArray(obj.evidence_used)
    ? obj.evidence_used.map(String)
    : [];

  const invalid = used.filter((t) => !allowedSignalTypes.includes(t));

  if (invalid.length > 0) {
    throw new Error(
      `A IA citou evidência inexistente: ${invalid.join(", ")}.`,
    );
  }

  return {
    message: obj.message.trim().slice(0, 1500),
    evidence_used: used,
  };
}
