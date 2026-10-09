import { DRAFT_INTENTS } from "./agent.types";
import type { DraftIntent } from "./agent.types";

export interface DraftResult {
  message: string;
  intent: DraftIntent;
  handoffReason: string | null;
  evidenceUsed: string[];
}

export const MAX_DRAFT_CHARS = 700;

/**
 * Valida o rascunho do Claude antes de salvar. Rejeita o que a IA
 * não pode fazer: inventar preço, enviar link, citar evidência que
 * não existe ou devolver intenção desconhecida.
 */
export function validateDraft(
  raw: unknown,
  ctx: { signalTypes: string[] },
): DraftResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Resposta da IA inválida.");
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.message !== "string" || !obj.message.trim()) {
    throw new Error("A IA não retornou mensagem.");
  }

  const message = obj.message.trim();

  if (message.length > MAX_DRAFT_CHARS) {
    throw new Error(
      `A mensagem passou de ${MAX_DRAFT_CHARS} caracteres: escreva mais curto.`,
    );
  }

  if (/r\$\s*\d|\d+\s*(reais|mil reais)\b/i.test(message)) {
    throw new Error(
      "A mensagem cita valores em dinheiro: não informe preços; proponha uma conversa para entender o escopo.",
    );
  }

  if (/https?:\/\/|www\./i.test(message)) {
    throw new Error("A mensagem contém link: não envie links.");
  }

  const intent = String(obj.intent ?? "").toUpperCase() as DraftIntent;

  if (!DRAFT_INTENTS.includes(intent)) {
    throw new Error(
      `Intenção inválida (${String(obj.intent)}); use ${DRAFT_INTENTS.join(", ")}.`,
    );
  }

  const evidence = Array.isArray(obj.evidence_used)
    ? obj.evidence_used.map(String)
    : [];

  const invalid = evidence.filter((t) => !ctx.signalTypes.includes(t));

  if (invalid.length > 0) {
    throw new Error(`A IA citou evidência inexistente: ${invalid.join(", ")}.`);
  }

  const reason =
    typeof obj.handoff_reason === "string" && obj.handoff_reason.trim()
      ? obj.handoff_reason.trim().slice(0, 400)
      : null;

  if (intent === "HANDOFF" && !reason) {
    throw new Error("Passagem para humano sem motivo.");
  }

  return {
    message,
    intent,
    handoffReason: intent === "HANDOFF" ? reason : null,
    evidenceUsed: evidence,
  };
}
