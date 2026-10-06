import type { Company } from "../companies/company.types";
import type { WebsiteFacts } from "../enrichment/website.facts";
import type { Signal, SignalType } from "../signals/signals.engine";

export interface ScoreReason {
  dimension: "FIT" | "NEED" | "CAPACITY" | "INTENT";
  points: number;
  reason: string;
}

export interface ScoreResult {
  fit: number;
  need: number;
  capacity: number;
  intent: number;
  total: number;
  confidence: number;
  reasons: ScoreReason[];
}

const NEED_WEIGHTS: Record<SignalType, number> = {
  NO_WEBSITE: 25,
  BROKEN_LINK: 15,
  WEAK_CONVERSION_PATH: 6,
  NO_HTTPS: 6,
  NO_MOBILE_SIGNAL: 6,
  NO_CLEAR_CTA: 5,
  NO_WHATSAPP: 5,
  OUTDATED_COPYRIGHT: 4,
  NO_FORM: 3,
  LOW_REVIEWS: 4,
};

const cap = (n: number) => Math.max(0, Math.min(25, n));

export interface ScoringInput {
  company: Company;
  signals: Signal[];
  facts: WebsiteFacts | null;
  preferredSegments?: string[];
  currentYear?: number;
}

/** Determinístico e explicável: cada ponto tem uma razão. */
export function computeScore(input: ScoringInput): ScoreResult {
  const { company, signals, facts } = input;
  const year = input.currentYear ?? new Date().getFullYear();
  const reasons: ScoreReason[] = [];

  const add = (
    dimension: ScoreReason["dimension"],
    points: number,
    reason: string,
  ) => {
    reasons.push({ dimension, points, reason });
    return points;
  };

  // FIT
  let fit = 0;
  if (company.segment) fit += add("FIT", 5, `Segmento informado: ${company.segment}`);
  if (company.city) fit += add("FIT", 5, `Cidade informada: ${company.city}`);
  const preferred = (input.preferredSegments ?? []).map((s) => s.toLowerCase());
  if (
    company.segment &&
    preferred.includes(company.segment.toLowerCase())
  ) {
    fit += add("FIT", 10, "Segmento está entre os preferidos");
  }
  if (company.phone || facts?.whatsappLinks.length) {
    fit += add("FIT", 5, "Há canal de contato direto (telefone/WhatsApp)");
  }

  // NEED
  let need = 0;
  for (const signal of signals) {
    const weight = NEED_WEIGHTS[signal.type] ?? 0;
    if (weight > 0) {
      need += add("NEED", weight, `${signal.type}: ${signal.evidence}`);
    }
  }

  // CAPACITY
  let capacity = 0;
  const reviews = company.reviews_count ?? 0;
  if (reviews >= 100) capacity += add("CAPACITY", 10, `${reviews} avaliações no Google (negócio com movimento)`);
  else if (reviews >= 30) capacity += add("CAPACITY", 7, `${reviews} avaliações no Google`);
  else if (reviews >= 10) capacity += add("CAPACITY", 4, `${reviews} avaliações no Google`);
  if ((company.rating ?? 0) >= 4.3) capacity += add("CAPACITY", 3, `Nota ${company.rating} no Google`);
  if (company.registration_status?.toUpperCase().includes("ATIVA")) {
    capacity += add("CAPACITY", 4, "CNPJ com situação ATIVA");
  }
  if ((company.capital ?? 0) >= 100_000) {
    capacity += add("CAPACITY", 4, `Capital social de R$ ${company.capital}`);
  }
  if (company.opened_at) {
    const openedYear = Number(company.opened_at.slice(0, 4));
    if (openedYear && year - openedYear >= 3) {
      capacity += add("CAPACITY", 4, `Empresa aberta em ${openedYear}`);
    }
  }

  // INTENT (proxies — não há dado direto de intenção de compra)
  let intent = 0;
  if (
    facts?.technologies.some((t) =>
      ["Google Analytics", "Meta Pixel"].includes(t),
    )
  ) {
    intent += add("INTENT", 10, "Usa ferramentas de tráfego/mensuração (investe em marketing)");
  }
  if (facts?.copyrightYear && facts.copyrightYear >= year - 1) {
    intent += add("INTENT", 5, "Site com manutenção recente");
  }
  if (facts && Object.keys(facts.socialLinks).length > 0) {
    intent += add("INTENT", 5, "Presença ativa em redes sociais");
  }

  fit = cap(fit);
  need = cap(need);
  capacity = cap(capacity);
  intent = cap(intent);

  let confidence = 0.2;
  if (company.rating != null) confidence += 0.25;
  if (facts && !facts.error) confidence += 0.35;
  else if (!company.website) confidence += 0.15;
  if (company.cnpj) confidence += 0.2;

  return {
    fit,
    need,
    capacity,
    intent,
    total: fit + need + capacity + intent,
    confidence: Math.min(1, Number(confidence.toFixed(2))),
    reasons,
  };
}
