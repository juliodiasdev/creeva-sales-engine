import { isGenericHost } from "../../lib/normalize";
import type { Company } from "../companies/company.types";
import type { WebsiteFacts } from "../enrichment/website.facts";
import { automationGaps } from "../automation/automation.engine";
import type { AutomationReport } from "../automation/automation.engine";
import { VISUAL_CHECKLIST } from "../visual/visual.checklist";
import type { VisualReview, VisualTarget } from "../visual/visual.checklist";

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
  | "NO_MOBILE_SIGNAL"
  // Vindos do código do site, do Google PageSpeed e da revisão visual (Instagram, WhatsApp, site).
  | "DATED_SITE"
  | "SLOW_SITE"
  | "NO_BANNERS"
  | "OLD_BANNERS"
  | "WEAK_SOCIAL_PROFILE"
  | "AUTOMATION_GAP";

export interface Signal {
  type: SignalType;
  value: string | null;
  evidence: string;
  source: "GOOGLE_PLACES" | "WEBSITE" | "MANUAL" | "VISUAL_REVIEW";
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
  reviews: VisualReview[] = [],
): Signal[] {
  return [
    ...deriveCoreSignals(company, facts, currentYear),
    ...deriveVisualSignals(facts, reviews),
  ];
}

function deriveCoreSignals(
  company: Pick<
    Company,
    "website" | "rating" | "reviews_count"
  >,
  facts: WebsiteFacts | null,
  currentYear: number,
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

/**
 * Sinais da revisão visual: só existem se o vendedor respondeu (ou conferiu a
 * sugestão da IA). Cada um cita a observação feita, nunca inventa.
 */
function deriveVisualSignals(
  facts: WebsiteFacts | null,
  reviews: VisualReview[],
): Signal[] {
  const signals: Signal[] = [];

  const answer = (target: VisualTarget, id: string) =>
    reviews.find((r) => r.target === target)?.answers.find((a) => a.id === id);

  const noted = (a: { note?: string } | undefined) => (a?.note ? `: ${a.note}` : ".");

  const igBanners = answer("INSTAGRAM", "banners");
  const siteHero = answer("SITE", "hero");

  if (igBanners?.status === "FAIL" || siteHero?.status === "FAIL") {
    signals.push({
      type: "NO_BANNERS",
      value: null,
      evidence: [
        igBanners?.status === "FAIL" ? `Instagram sem banners ou artes de divulgação (revisão visual)${noted(igBanners)}` : null,
        siteHero?.status === "FAIL" ? `Site sem banner principal (revisão visual)${noted(siteHero)}` : null,
      ].filter(Boolean).join(" "),
      source: "VISUAL_REVIEW",
      confidence: 0.8,
    });
  } else if (igBanners?.status === "WARN" || siteHero?.status === "WARN") {
    signals.push({
      type: "OLD_BANNERS",
      value: null,
      evidence: [
        igBanners?.status === "WARN" ? `Instagram com artes antigas ou amadoras (revisão visual)${noted(igBanners)}` : null,
        siteHero?.status === "WARN" ? `Banner principal do site fraco ou genérico (revisão visual)${noted(siteHero)}` : null,
      ].filter(Boolean).join(" "),
      source: "VISUAL_REVIEW",
      confidence: 0.7,
    });
  }

  const cues = facts && !facts.error ? (facts.legacyCues ?? []) : [];
  const design = answer("SITE", "design");

  if (cues.length >= 2 || design?.status === "FAIL") {
    signals.push({
      type: "DATED_SITE",
      value: null,
      evidence: [
        cues.length >= 2 ? `Sinais de site antigo no código: ${cues.join("; ")}.` : null,
        design?.status === "FAIL" ? `Aparência do site datada (revisão visual)${noted(design)}` : null,
      ].filter(Boolean).join(" "),
      source: design?.status === "FAIL" ? "VISUAL_REVIEW" : "WEBSITE",
      confidence: design?.status === "FAIL" ? 0.8 : 0.7,
    });
  }

  const metrics = reviews.find((r) => r.target === "SITE")?.metrics;

  if (metrics && metrics.performance !== null && metrics.performance < 50) {
    signals.push({
      type: "SLOW_SITE",
      value: String(metrics.performance),
      evidence: `Google PageSpeed (celular): nota ${metrics.performance}/100${metrics.lcpMs != null ? `, conteúdo principal em ${(metrics.lcpMs / 1000).toFixed(1)} s` : ""}.`,
      source: "WEBSITE",
      confidence: 0.9,
    });
  }

  const WEAK: [VisualTarget, string[], string][] = [
    ["INSTAGRAM", ["avatar", "bio", "link", "identity", "recency"], "Instagram"],
    ["WHATSAPP", ["business", "photo", "profile"], "WhatsApp Business"],
  ];

  const weak = WEAK.flatMap(([target, ids, name]) => {
    const labels = ids
      .filter((id) => answer(target, id)?.status === "FAIL")
      .map((id) => VISUAL_CHECKLIST[target].find((i) => i.id === id)!.label);

    return labels.length > 0 ? [`${name} — ${labels.join(", ")}`] : [];
  });

  if (weak.length > 0) {
    signals.push({
      type: "WEAK_SOCIAL_PROFILE",
      value: null,
      evidence: `Perfil fraco na revisão visual: ${weak.join("; ")}.`,
      source: "VISUAL_REVIEW",
      confidence: 0.75,
    });
  }

  return signals;
}

/**
 * Um sinal só quando há área aplicável SEM automação encontrada. A evidência diz o que foi
 * encontrado e lembra que ausência no site não prova que a empresa não usa a ferramenta.
 */
export function deriveAutomationSignal(report: AutomationReport): Signal | null {
  const gaps = automationGaps(report);

  if (gaps.length === 0) return null;

  const confirmed = gaps.some((g) => g.state === "CONFIRMED_GAP");

  return {
    type: "AUTOMATION_GAP",
    value: String(gaps.length),
    evidence: `Sem automação encontrada em: ${gaps.map((g) => g.label.replace(/ \(.*\)$/, "")).join(", ")}. ${confirmed ? "Parte conferida na revisão; o restante" : "Isso"} vem da leitura do site e precisa ser confirmado com a empresa.`,
    source: confirmed ? "VISUAL_REVIEW" : "WEBSITE",
    confidence: confirmed ? 0.7 : 0.5,
  };
}
