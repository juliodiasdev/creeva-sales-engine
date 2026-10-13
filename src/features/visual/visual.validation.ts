import { VISUAL_CHECKLIST } from "./visual.checklist";
import type { VisualAnswer, VisualStatus, VisualTarget } from "./visual.checklist";

const STATUSES: VisualStatus[] = ["OK", "WARN", "FAIL"];

export const MAX_NOTE = 160;
export const MAX_SUMMARY = 400;

/** Texto de observação: uma linha, sem marcação, tamanho limitado. */
export function cleanNote(value: unknown, max = MAX_NOTE): string | undefined {
  if (typeof value !== "string") return undefined;

  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

  return text || undefined;
}

/**
 * Aceita só perguntas do checklist daquele alvo e só OK/WARN/FAIL. Tudo que
 * a IA (ou a tela) mandar fora disso é descartado, nunca "corrigido".
 */
export function validateAnswers(target: VisualTarget, raw: unknown): VisualAnswer[] {
  if (!Array.isArray(raw)) return [];

  const allowed = new Set(VISUAL_CHECKLIST[target].map((i) => i.id));
  const seen = new Set<string>();
  const answers: VisualAnswer[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;

    const { id, status, note } = entry as Record<string, unknown>;

    if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) continue;
    if (typeof status !== "string" || !STATUSES.includes(status as VisualStatus)) continue;

    seen.add(id);
    answers.push({
      id,
      status: status as VisualStatus,
      ...(cleanNote(note) ? { note: cleanNote(note) } : {}),
    });
  }

  return answers;
}
