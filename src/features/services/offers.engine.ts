import type { Company } from "../companies/company.types";
import type { WebsiteFacts } from "../enrichment/website.facts";
import type { Signal, SignalType } from "../signals/signals.engine";
import type { ServiceKey } from "./services.service";

export interface ServiceMatch {
  key: ServiceKey;
  score: number;
  /** Cada razão aponta para um fato real (sinal, dado do Google, CNPJ). */
  reasons: string[];
  /** Tipos de sinal que sustentam a recomendação. */
  signals: SignalType[];
}

const SEGMENTS_WITH_SCHEDULE = [
  "odont", "clinic", "saude", "medic", "fisio", "psico", "estetic", "advoc",
  "academia", "imobili", "salao", "barbear", "veterin", "pet",
];

const lower = (v: string | null | undefined) =>
  (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Determinístico: cruza FATOS com o catálogo de serviços e devolve os
 * serviços mais adequados com as razões. Sem IA, sem inventar.
 */
export function matchServices(input: {
  company: Pick<
    Company,
    | "segment"
    | "website"
    | "reviews_count"
    | "rating"
    | "company_size"
    | "capital"
  >;
  signals: Pick<Signal, "type" | "evidence">[];
  facts: WebsiteFacts | null;
  activeKeys?: ServiceKey[];
}): ServiceMatch[] {
  const { company, signals, facts } = input;

  const acc = new Map<ServiceKey, ServiceMatch>();

  const add = (
    key: ServiceKey,
    points: number,
    reason: string,
    signal?: SignalType,
  ) => {
    const m = acc.get(key) ?? { key, score: 0, reasons: [], signals: [] };

    m.score += points;
    m.reasons.push(reason);

    if (signal && !m.signals.includes(signal)) m.signals.push(signal);

    acc.set(key, m);
  };

  const has = (type: SignalType) => signals.find((s) => s.type === type);
  const evidence = (type: SignalType) => has(type)?.evidence ?? type;

  // Site e loja
  if (has("NO_WEBSITE")) {
    add("SITE_LOJA", 6, "Sem site cadastrado/encontrado", "NO_WEBSITE");
    add("LANDING_PAGE", 2, "Sem página própria para captar contatos", "NO_WEBSITE");
  }
  if (has("BROKEN_LINK")) add("SITE_LOJA", 5, evidence("BROKEN_LINK"), "BROKEN_LINK");
  if (has("NO_HTTPS")) add("SITE_LOJA", 3, evidence("NO_HTTPS"), "NO_HTTPS");
  if (has("NO_MOBILE_SIGNAL")) add("SITE_LOJA", 3, evidence("NO_MOBILE_SIGNAL"), "NO_MOBILE_SIGNAL");
  if (has("OUTDATED_COPYRIGHT")) {
    add("SITE_LOJA", 2, evidence("OUTDATED_COPYRIGHT"), "OUTDATED_COPYRIGHT");
    add("SUPORTE", 3, "Site sem manutenção aparente: " + evidence("OUTDATED_COPYRIGHT"), "OUTDATED_COPYRIGHT");
  }

  // Landing pages / conversão
  if (has("WEAK_CONVERSION_PATH")) add("LANDING_PAGE", 5, evidence("WEAK_CONVERSION_PATH"), "WEAK_CONVERSION_PATH");
  if (has("NO_CLEAR_CTA")) add("LANDING_PAGE", 3, evidence("NO_CLEAR_CTA"), "NO_CLEAR_CTA");
  if (has("NO_FORM")) add("LANDING_PAGE", 2, evidence("NO_FORM"), "NO_FORM");
  if (
    facts?.technologies.some((t) => ["Google Analytics", "Meta Pixel"].includes(t))
  ) {
    add("LANDING_PAGE", 3, "Já usa ferramentas de mensuração/anúncios: landing pages aumentam a conversão do tráfego");
  }

  // Sistemas e automações
  if (has("NO_WHATSAPP")) add("SISTEMA_AUTOMACAO", 2, evidence("NO_WHATSAPP"), "NO_WHATSAPP");
  const reviews = company.reviews_count ?? 0;
  if (reviews >= 100) {
    add("SISTEMA_AUTOMACAO", 3, `${reviews} avaliações no Google: volume de clientes que pede organização/automação`);
  } else if (reviews >= 40) {
    add("SISTEMA_AUTOMACAO", 1, `${reviews} avaliações no Google`);
  }
  if (SEGMENTS_WITH_SCHEDULE.some((k) => lower(company.segment).includes(k))) {
    add("SISTEMA_AUTOMACAO", 2, `Segmento (${company.segment}) com agenda, cobrança e atendimento recorrentes`);
  }

  // Software e aplicativos (empresas maiores / operação própria)
  if ((company.capital ?? 0) >= 500_000) {
    add("SOFTWARE_APP", 3, `Capital social de R$ ${company.capital}: porte para solução sob medida`);
  }
  if (/m[eé]dia|grande|demais/i.test(company.company_size ?? "")) {
    add("SOFTWARE_APP", 3, `Porte da empresa: ${company.company_size}`);
  }
  if (reviews >= 300) {
    add("SOFTWARE_APP", 2, `${reviews} avaliações no Google: operação de grande volume`);
  }

  // Suporte contínuo: quem tem site funcionando é candidato natural
  if (facts && !facts.error && company.website) {
    add("SUPORTE", 1, "Possui site no ar: manutenção e evolução contínuas");
  }

  const allowed = input.activeKeys;

  return [...acc.values()]
    .filter((m) => m.score > 0 && (!allowed || allowed.includes(m.key)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
