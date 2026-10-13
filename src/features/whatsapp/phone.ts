import { normalizePhone } from "../../lib/normalize";

/**
 * Possíveis formas de um mesmo número brasileiro. A Meta às vezes entrega o
 * celular sem o 9º dígito (DDD + 8 dígitos), enquanto o cadastro tem DDD + 9 + 8.
 */
export function phoneVariants(raw: string): string[] {
  const base = normalizePhone(raw);

  if (!base) return [];

  const variants = new Set([base]);

  if (base.length === 10 && /[6-9]/.test(base[2])) {
    // DDD + 8 dígitos começando em 6–9: pode ser celular antigo (sem o 9).
    // (fixos começam em 2–5 e não ganham o 9)
    variants.add(`${base.slice(0, 2)}9${base.slice(2)}`);
  } else if (base.length === 11 && base[2] === "9") {
    variants.add(`${base.slice(0, 2)}${base.slice(3)}`);
  }

  return [...variants];
}
