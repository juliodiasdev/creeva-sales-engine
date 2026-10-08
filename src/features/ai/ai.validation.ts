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

/* ---------- plano completo: serviços + abordagens ---------- */

export interface AiServiceRecommendation {
  service_key: string;
  reason: string;
  pitch: string;
}

export interface AiApproach {
  channel: string;
  service_key: string | null;
  angle: string;
  message: string;
  evidence_used: string[];
}

export interface AiPlanResult {
  analysis: AiAnalysisResult;
  services: AiServiceRecommendation[];
  approaches: AiApproach[];
  /** Itens descartados por não respeitarem o catálogo/evidências. */
  dropped: number;
}

/**
 * Valida a resposta única da IA (análise + serviços + abordagens).
 * Itens inválidos (serviço fora do catálogo, canal indisponível,
 * evidência inexistente) são DESCARTADOS, nunca salvos.
 */
export function validatePlan(
  raw: unknown,
  ctx: {
    serviceKeys: string[];
    channels: string[];
    signalTypes: string[];
  },
): AiPlanResult {
  const analysis = validateAnalysis(raw);
  const obj = raw as Record<string, unknown>;
  let dropped = 0;

  const services: AiServiceRecommendation[] = [];

  for (const item of Array.isArray(obj.recommended_services)
    ? obj.recommended_services
    : []) {
    const r = item as Record<string, unknown>;

    if (
      typeof r?.service_key === "string" &&
      ctx.serviceKeys.includes(r.service_key) &&
      typeof r.reason === "string" &&
      r.reason.trim()
    ) {
      services.push({
        service_key: r.service_key,
        reason: r.reason.trim().slice(0, 500),
        pitch: String(r.pitch ?? "").trim().slice(0, 500),
      });
    } else {
      dropped++;
    }
  }

  const approaches: AiApproach[] = [];

  for (const item of Array.isArray(obj.approaches) ? obj.approaches : []) {
    const a = item as Record<string, unknown>;
    const evidence = Array.isArray(a?.evidence_used)
      ? a.evidence_used.map(String)
      : [];

    const valid =
      typeof a?.channel === "string" &&
      ctx.channels.includes(a.channel) &&
      typeof a.message === "string" &&
      a.message.trim().length > 0 &&
      evidence.every((t) => ctx.signalTypes.includes(t)) &&
      (a.service_key == null ||
        ctx.serviceKeys.includes(String(a.service_key)));

    if (valid) {
      approaches.push({
        channel: String(a.channel),
        service_key: a.service_key == null ? null : String(a.service_key),
        angle: String(a.angle ?? "").trim().slice(0, 300),
        message: String(a.message).trim().slice(0, 900),
        evidence_used: evidence,
      });
    } else {
      dropped++;
    }
  }

  return { analysis, services, approaches, dropped };
}
