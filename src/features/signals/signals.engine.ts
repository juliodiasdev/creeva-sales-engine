import { isGenericHost } from "../../lib/normalize";
import type { Company } from "../companies/company.types";
import type { WebsiteFacts } from "../enrichment/website.facts";

export type SignalType =
  | "NO_WEBSITE"
  | "NO_HTTPS"
  | "NO_WHATSAPP"
  | "NO_CLEAR_CTA"
  | "NO_FORM"
  | "OUTDATED_COPYRIGHT"
  | "LOW_REVIEWS"
  | "BROKEN_LINK"
  | "WEAK_CONVERSION_PATH"
  | "NO_MOBILE_SIGNAL";

export interface Signal {
  type: SignalType;
  value: string | null;
  evidence: string;
  source: "GOOGLE_PLACES" | "WEBSITE" | "MANUAL";
  confidence: number;
}

/**
 * Determinístico: transforma FATOS em SIGNALS, sempre com evidência.
 * Sem facts de website, nenhum signal de website é emitido
 * (ausência de dado não é evidência de problema).
 */
export function deriveSignals(
  company: Pick<
    Company,
    "website" | "rating" | "reviews_count"
  >,
  facts: WebsiteFacts | null,
  currentYear = new Date().getFullYear(),
): Signal[] {
  const signals: Signal[] = [];

  const hasOwnSite = !!company.website && !isGenericHost(company.website);

  if (!hasOwnSite) {
    signals.push({
      type: "NO_WEBSITE",
      value: company.website,
      evidence: company.website
        ? `O único "site" cadastrado é um perfil/link de terceiros (${company.website}), não um site próprio.`
        : "Nenhum website cadastrado/encontrado para a empresa.",
      source: "GOOGLE_PLACES",
      confidence: 0.8,
    });
  }

  if (
    company.reviews_count != null &&
    (company.reviews_count < 10 ||
      (company.rating != null && company.rating < 4))
  ) {
    signals.push({
      type: "LOW_REVIEWS",
      value: String(company.reviews_count),
      evidence: `Google: ${company.reviews_count} avaliações, nota ${company.rating ?? "n/d"}.`,
      source: "GOOGLE_PLACES",
      confidence: 0.9,
    });
  }

  if (!facts) return signals;

  if (facts.error || (facts.httpStatus ?? 200) >= 400) {
    signals.push({
      type: "BROKEN_LINK",
      value: facts.error,
      evidence: `O site ${facts.url} não carregou (${facts.error ?? facts.httpStatus}).`,
      source: "WEBSITE",
      confidence: 0.7,
    });

    return signals;
  }

  if (!facts.https) {
    signals.push({
      type: "NO_HTTPS",
      value: facts.finalUrl,
      evidence: `O site abre em ${facts.finalUrl}, sem HTTPS.`,
      source: "WEBSITE",
      confidence: 0.95,
    });
  }

  if (!facts.hasViewport) {
    signals.push({
      type: "NO_MOBILE_SIGNAL",
      value: null,
      evidence: "A página não declara meta viewport (sinal de que pode não ser adaptada ao celular).",
      source: "WEBSITE",
      confidence: 0.6,
    });
  }

  if (facts.whatsappLinks.length === 0) {
    signals.push({
      type: "NO_WHATSAPP",
      value: null,
      evidence: "Nenhum link de WhatsApp encontrado na página inicial.",
      source: "WEBSITE",
      confidence: 0.7,
    });
  }

  if (facts.ctas.length === 0) {
    signals.push({
      type: "NO_CLEAR_CTA",
      value: null,
      evidence: "Nenhum botão/link de ação (agendar, orçamento, contato) identificado na página inicial.",
      source: "WEBSITE",
      confidence: 0.65,
    });
  }

  if (facts.formsCount === 0) {
    signals.push({
      type: "NO_FORM",
      value: null,
      evidence: "Nenhum formulário na página inicial.",
      source: "WEBSITE",
      confidence: 0.6,
    });
  }

  if (
    facts.copyrightYear != null &&
    facts.copyrightYear <= currentYear - 2
  ) {
    signals.push({
      type: "OUTDATED_COPYRIGHT",
      value: String(facts.copyrightYear),
      evidence: `Rodapé indica copyright de ${facts.copyrightYear}.`,
      source: "WEBSITE",
      confidence: 0.6,
    });
  }

  if (
    facts.ctas.length === 0 &&
    facts.formsCount === 0 &&
    facts.whatsappLinks.length === 0
  ) {
    signals.push({
      type: "WEAK_CONVERSION_PATH",
      value: null,
      evidence: "Sem CTA, formulário nem WhatsApp na página inicial: o caminho até o contato/agendamento não está destacado.",
      source: "WEBSITE",
      confidence: 0.7,
    });
  }

  return signals;
}
