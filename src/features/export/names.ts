import { normalizeText } from "../../lib/normalize";

/** Radicais de palavras que descrevem serviço/local, não o nome do negócio. */
const GENERIC_STEMS = [
  "dent", "odont", "clinic", "consultor", "cirurgi", "implant", "faceta",
  "estetic", "automotiv", "advog", "academ", "restaur", "imobili", "cuiab",
  "reabilit", "oral", "harmoniz", "ortodon", "especialis", "melhor",
  "centro", "bairro", "servic", "salao", "barbear", "pet", "veterin",
];

const FILLER = new Set(["jardim", "vila", "parque", "setor", "residencial", "mt", "em", "de", "da", "do", "das", "dos", "e", "a", "o", "para", "na", "no"]);

/** Quantas palavras do trecho NÃO são genéricas (indício de ser o nome). */
function nameWords(segment: string): number {
  return normalizeText(segment)
    .split(" ")
    .filter(
      (w) =>
        w && !FILLER.has(w) && !GENERIC_STEMS.some((stem) => w.includes(stem)),
    ).length;
}

/** Remove "… Dentista em Cuiabá" do fim do trecho escolhido. */
function trimTail(text: string): string {
  return text
    .replace(/\s+(cirurgi[ãa]o[- ])?dentista(\s+(em|de))?\s+cuiab[áa](\s+mt)?\s*$/i, "")
    .replace(/\s+(em|de)\s+cuiab[áa](\s+mt)?\s*$/i, "")
    .replace(/\s+dentista\s*$/i, "")
    .trim();
}

/**
 * Títulos do Google costumam vir cheios de palavras-chave:
 * "Dentista em Cuiabá MT | Myrelief | Clínica Odontológica | Implante…".
 * Escolhe o trecho que mais parece o nome do negócio; se todos forem
 * genéricos, usa o primeiro. O nome original fica em outra coluna.
 */
export function cleanBusinessName(name: string): string {
  const raw = name.replace(/\s+/g, " ").trim();
  const parts = raw
    .split(/\s[|–—]\s|\s-\s/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) return trimTail(raw) || raw;

  let best = parts[0];
  let bestScore = nameWords(parts[0]);

  for (const part of parts.slice(1)) {
    const score = nameWords(part);

    if (score > bestScore) {
      best = part;
      bestScore = score;
    }
  }

  return (trimTail(best) || best).slice(0, 80);
}
