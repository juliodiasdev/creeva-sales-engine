import type { Company } from "../companies/company.types";
import type { WebsiteFacts } from "../enrichment/website.facts";
import type { ServiceKey } from "../services/services.service";
import { isGenericHost, normalizeDomain } from "../../lib/normalize";
import {
  VISUAL_CHECKLIST,
  VISUAL_TARGET_LABEL,
} from "../visual/visual.checklist";
import type { VisualReview, VisualTarget } from "../visual/visual.checklist";

/**
 * Avaliação da PRESENÇA DIGITAL de uma empresa. 100% determinística e baseada
 * só em dados reais coletados (Google Maps, site, canais). O que não foi
 * possível medir é marcado como UNKNOWN e NÃO entra na nota.
 */
export const PRESENCE_VERSION = 2;

export type CheckStatus = "OK" | "WARN" | "FAIL" | "UNKNOWN";

export type DimensionKey = "GOOGLE" | "SITE" | "SOCIAL" | "VISUAL" | "CONTACT" | "CONVERSION";

export interface Check {
  id: string;
  dimension: DimensionKey;
  label: string;
  status: CheckStatus;
  /** O que foi encontrado (ou por que não foi possível medir). */
  detail: string;
  /** Peso dentro da dimensão. */
  weight: number;
  /** Serviço da Creava que resolve este ponto (quando for uma lacuna). */
  service: ServiceKey | null;
}

export interface Dimension {
  key: DimensionKey;
  label: string;
  /** Peso na nota final. */
  weight: number;
  /** 0–100; null quando nada pôde ser medido. */
  score: number | null;
  checks: Check[];
}

export type PresenceLevel = "NONE" | "BASIC" | "INTERMEDIATE" | "ADVANCED";

/** Faixas da nota (0–100): abaixo de 45 = básica · 45 a 69 = intermediária · 70+ = avançada. */
export const LEVEL_THRESHOLDS = { BASIC: 45, INTERMEDIATE: 70 } as const;

export const LEVEL_LABEL: Record<PresenceLevel, string> = {
  NONE: "Sem presença digital",
  BASIC: "Presença básica",
  INTERMEDIATE: "Presença intermediária",
  ADVANCED: "Presença avançada",
};

/** READY = hora de vender · NEEDS_DATA = enriquecer antes · NO_GAP = presença forte, pouca brecha */
export type SaleMoment = "READY" | "NEEDS_DATA" | "NO_GAP";

export const MOMENT_LABEL: Record<SaleMoment, string> = {
  READY: "Hora de vender",
  NEEDS_DATA: "Faltam dados",
  NO_GAP: "Poucas brechas",
};

export interface Offer {
  service: ServiceKey;
  /** Lacunas reais que sustentam esta oferta. */
  reasons: string[];
  weight: number;
}

export interface PresenceReport {
  version: number;
  /** 0–100; null quando não há dado suficiente para pontuar. */
  score: number | null;
  level: PresenceLevel;
  /** Parcela do peso total que pôde ser medida (0–1). */
  confidence: number;
  moment: SaleMoment;
  /** Frase curta explicando a posição da empresa. */
  position: string;
  dimensions: Dimension[];
  /** Pontos fortes (OK de maior peso). */
  strengths: Check[];
  /** Lacunas (FAIL/WARN) da mais pesada para a mais leve. */
  gaps: Check[];
  /** O que vender, por serviço, com os motivos reais. */
  offers: Offer[];
  /** Por que ainda não é a hora (quando faltam dados). */
  blockers: string[];
  /** Ressalvas sobre o que o app NÃO consegue medir. */
  notes: string[];
  /** Revisões visuais (Instagram, WhatsApp, site) que ainda faltam fazer. Ausente em relatórios antigos. */
  pending?: string[];
}

const DIMENSION_META: Record<DimensionKey, { label: string; weight: number }> = {
  GOOGLE: { label: "Google Maps", weight: 15 },
  SITE: { label: "Site", weight: 35 },
  SOCIAL: { label: "Redes sociais", weight: 10 },
  VISUAL: { label: "Imagem e perfis (banners, Instagram, WhatsApp)", weight: 20 },
  CONTACT: { label: "Canais de contato", weight: 10 },
  CONVERSION: { label: "Conversão e vendas online", weight: 10 },
};

const VALUE: Record<CheckStatus, number | null> = {
  OK: 1,
  WARN: 0.5,
  FAIL: 0,
  UNKNOWN: null,
};

/** Subdomínios de construtores gratuitos: não é domínio próprio. */
const FREE_BUILDERS =
  /(wixsite\.com|wordpress\.com|blogspot\.com|weebly\.com|webnode\.|negocio\.site|business\.site|site123\.me|yolasite\.com|sites\.google\.com|carrd\.co|notion\.site)$/i;

const RETAIL =
  /(loja|moda|roupa|cal[çc]ado|joia|jóia|m[óo]vel|m[óo]veis|eletro|cosm[ée]tic|perfum|livraria|papelaria|presente|brinquedo|pet ?shop|farm[áa]cia|suplemento|mercado|comércio|comercio)/i;

const BOOKING =
  /(odont|dentist|cl[íi]nica|m[ée]dic|psic|fisio|nutri|est[ée]tica|beleza|sal[ãa]o|barbear|spa|advog|veterin|restaurante|academia|studio|est[úu]dio|consult[óo]rio)/i;

interface Input {
  company: Company;
  /** Canais já consolidados (um por tipo é suficiente). */
  channels: { kind: string; value: string; label: string | null }[];
  facts: WebsiteFacts | null;
  /** Revisões visuais já feitas (Instagram, WhatsApp, aparência do site). */
  reviews?: VisualReview[];
  now?: Date;
}

const check = (
  id: string,
  dimension: DimensionKey,
  label: string,
  status: CheckStatus,
  detail: string,
  weight: number,
  service: ServiceKey | null = null,
): Check => ({ id, dimension, label, status, detail, weight, service });

export function assessPresence(input: Input): PresenceReport {
  const { company, channels, facts } = input;
  const visualReviews = input.reviews ?? [];
  const year = (input.now ?? new Date()).getFullYear();
  const has = (kind: string) => channels.some((c) => c.kind === kind);

  const websiteIsSocial = !!company.website && isGenericHost(company.website);
  const hasSite =
    (!!company.website && !websiteIsSocial) ||
    channels.some((c) => c.kind === "WEBSITE");
  const domain = normalizeDomain(company.website) ?? "";

  const checks: Check[] = [];

  /* ---------- Google Maps ---------- */
  const rating = company.rating;
  const reviews = company.reviews_count ?? 0;

  checks.push(
    check(
      "google.rating",
      "GOOGLE",
      "Nota no Google",
      rating === null || rating === undefined
        ? "WARN"
        : rating >= 4.3
          ? "OK"
          : rating >= 3.8
            ? "WARN"
            : "FAIL",
      rating === null || rating === undefined
        ? "Sem nota pública no Google."
        : `Nota ${rating} no Google.`,
      3,
      null,
    ),
    check(
      "google.reviews",
      "GOOGLE",
      "Volume de avaliações",
      reviews >= 50 ? "OK" : reviews >= 10 ? "WARN" : "FAIL",
      `${reviews} avaliação(ões) no Google.`,
      3,
      "SISTEMA_AUTOMACAO",
    ),
    check(
      "google.profile",
      "GOOGLE",
      "Perfil completo (endereço, telefone, categoria)",
      company.address && company.phone && (company.category || company.segment)
        ? "OK"
        : company.address || company.phone
          ? "WARN"
          : "FAIL",
      [
        company.address ? "endereço" : "sem endereço",
        company.phone ? "telefone" : "sem telefone",
        company.category || company.segment ? "categoria" : "sem categoria",
      ].join(" · "),
      2,
    ),
  );

  /* ---------- Site ---------- */
  checks.push(
    check(
      "site.exists",
      "SITE",
      "Tem site próprio",
      hasSite ? "OK" : "FAIL",
      hasSite
        ? `Site: ${domain || "cadastrado"}.`
        : websiteIsSocial
          ? "O cadastro só tem um link de rede social, não um site próprio."
          : "Nenhum site encontrado.",
      6,
      "SITE_LOJA",
    ),
  );

  if (hasSite) {
    const crawled = !!facts;
    const offline = !!facts && (!!facts.error || (facts.httpStatus ?? 200) >= 400);
    const ok = crawled && !offline;
    const unknown = (what: string) => `Não medido: ${what}.`;

    checks.push(
      check(
        "site.domain",
        "SITE",
        "Domínio próprio",
        domain && FREE_BUILDERS.test(domain) ? "FAIL" : "OK",
        domain && FREE_BUILDERS.test(domain)
          ? `${domain} é um endereço de construtor gratuito.`
          : "Endereço próprio.",
        1,
        "SITE_LOJA",
      ),
      check(
        "site.online",
        "SITE",
        "Site no ar",
        !crawled ? "UNKNOWN" : offline ? "FAIL" : "OK",
        !crawled
          ? unknown("o site ainda não foi lido (rode o enriquecimento)")
          : offline
            ? `O site não abriu (${facts!.error ?? `HTTP ${facts!.httpStatus}`}).`
            : "Abre normalmente.",
        5,
        "SITE_LOJA",
      ),
    );

    if (ok) {
      const f = facts!;
      const secure = f.https;
      const tracked = f.technologies.some((t) => /Analytics|Pixel/i.test(t));

      checks.push(
        check("site.https", "SITE", "Cadeado de segurança (HTTPS)", secure ? "OK" : "FAIL",
          secure ? "Usa HTTPS." : "Sem HTTPS: navegadores avisam que o site não é seguro.", 4, "SITE_LOJA"),
        check("site.mobile", "SITE", "Funciona no celular", f.hasViewport ? "OK" : "FAIL",
          f.hasViewport ? "Declara layout para celular." : "Sem sinal de layout para celular.", 4, "SITE_LOJA"),
        check("site.speed", "SITE", "Resposta do servidor",
          f.loadMs == null ? "UNKNOWN" : f.loadMs < 1500 ? "OK" : f.loadMs < 3500 ? "WARN" : "FAIL",
          f.loadMs == null
            ? unknown("tempo de resposta (leitura antiga)")
            : `A página inicial respondeu em ${(f.loadMs / 1000).toFixed(1)} s (mede só o servidor, não o carregamento completo).`,
          3, "SITE_LOJA"),
        check("site.seo", "SITE", "Título e descrição (aparece no Google)",
          f.title && f.description ? "OK" : f.title || f.description ? "WARN" : "FAIL",
          [f.title ? "título" : "sem título", f.description ? "descrição" : "sem descrição"].join(" · "),
          2, "SITE_LOJA"),
        check("site.cta", "SITE", "Botão de ação claro", f.ctas.length > 0 ? "OK" : "FAIL",
          f.ctas.length > 0 ? `Encontrado: “${f.ctas[0]}”.` : "Nenhum botão como “agendar” ou “pedir orçamento”.", 4, "LANDING_PAGE"),
        check("site.whatsapp", "SITE", "Botão de WhatsApp", f.whatsappLinks.length > 0 ? "OK" : "FAIL",
          f.whatsappLinks.length > 0 ? "Tem link de WhatsApp." : "Sem botão de WhatsApp no site.", 3, "SISTEMA_AUTOMACAO"),
        check("site.form", "SITE", "Formulário de contato", f.formsCount > 0 ? "OK" : "WARN",
          f.formsCount > 0 ? "Tem formulário." : "Sem formulário de contato.", 2, "LANDING_PAGE"),
        check("site.fresh", "SITE", "Site atualizado",
          f.copyrightYear == null ? "UNKNOWN" : f.copyrightYear >= year - 1 ? "OK" : f.copyrightYear >= year - 3 ? "WARN" : "FAIL",
          f.copyrightYear == null ? unknown("sem ano no rodapé") : `Rodapé indica ${f.copyrightYear}.`,
          2, "SITE_LOJA"),
        check("site.tracking", "SITE", "Mede visitas e anúncios", tracked ? "OK" : "WARN",
          tracked ? "Google Analytics ou Pixel encontrado." : "Não encontrado no código (pode estar em ferramenta externa).", 2, "LANDING_PAGE"),
        check("site.lgpd", "SITE", "Política de privacidade (LGPD)",
          f.hasPrivacyLink === undefined ? "UNKNOWN" : f.hasPrivacyLink ? "OK" : "WARN",
          f.hasPrivacyLink === undefined ? unknown("leitura antiga") : f.hasPrivacyLink ? "Link encontrado." : "Sem link de privacidade.", 1, "SITE_LOJA"),
        check("site.legacy", "SITE", "Tecnologia do site (código antigo?)",
          f.legacyCues === undefined ? "UNKNOWN" : f.legacyCues.length === 0 ? "OK" : f.legacyCues.length === 1 ? "WARN" : "FAIL",
          f.legacyCues === undefined
            ? unknown("leitura antiga; refaça o enriquecimento")
            : f.legacyCues.length === 0
              ? "Nenhum sinal de código antigo."
              : `Sinais de site antigo: ${f.legacyCues.join("; ")}.`,
          4, "SITE_LOJA"),
        check("site.images", "SITE", "Imagens da página inicial",
          f.images === undefined
            ? "UNKNOWN"
            : f.images.total === 0 || f.images.optimized / f.images.total < 0.5 || f.images.withAlt / f.images.total < 0.5
              ? "WARN"
              : "OK",
          f.images === undefined
            ? unknown("leitura antiga; refaça o enriquecimento")
            : f.images.total === 0
              ? "Nenhuma imagem encontrada no código da página inicial (pode ser carregada por JavaScript)."
              : `${f.images.total} imagem(ns): ${f.images.withAlt} com texto alternativo, ${f.images.optimized} com formato/carregamento moderno.`,
          1, "SITE_LOJA"),
      );
    }

    const psi = visualReviews.find((r) => r.target === "SITE")?.metrics;

    if (psi && psi.performance !== null) {
      const extra = [
        psi.lcpMs != null ? `conteúdo principal em ${(psi.lcpMs / 1000).toFixed(1)} s` : null,
        psi.seo != null ? `SEO ${psi.seo}` : null,
        psi.bestPractices != null ? `boas práticas ${psi.bestPractices}` : null,
        psi.accessibility != null ? `acessibilidade ${psi.accessibility}` : null,
      ].filter(Boolean);

      checks.push(
        check("site.psi", "SITE", "Desempenho no celular (teste do Google)",
          psi.performance >= 90 ? "OK" : psi.performance >= 50 ? "WARN" : "FAIL",
          `Nota ${psi.performance}/100 no Google PageSpeed (celular)${extra.length ? `; ${extra.join(" · ")}` : ""}.`,
          4, "SITE_LOJA"),
      );
    }
  }

  /* ---------- Redes sociais ---------- */
  const socials = ["INSTAGRAM", "FACEBOOK", "LINKEDIN"].filter(has);

  checks.push(
    check("social.instagram", "SOCIAL", "Instagram", has("INSTAGRAM") ? "OK" : "FAIL",
      has("INSTAGRAM") ? "Perfil encontrado." : "Nenhum perfil de Instagram encontrado.", 4, "DESIGN_SOCIAL"),
    check("social.facebook", "SOCIAL", "Facebook", has("FACEBOOK") ? "OK" : "WARN",
      has("FACEBOOK") ? "Página encontrada." : "Nenhuma página de Facebook encontrada.", 2),
    check("social.linkedin", "SOCIAL", "LinkedIn", has("LINKEDIN") ? "OK" : "WARN",
      has("LINKEDIN") ? "Página encontrada." : "Nenhuma página de LinkedIn encontrada.", 1),
  );

  if (facts && !facts.error) {
    checks.push(
      check("social.linked", "SOCIAL", "Site liga às redes sociais",
        Object.keys(facts.socialLinks).length > 0 ? "OK" : socials.length > 0 ? "WARN" : "UNKNOWN",
        Object.keys(facts.socialLinks).length > 0 ? "O site tem links para as redes." : "As redes existem, mas o site não leva a elas.",
        1, "SITE_LOJA"),
    );
  }

  /* ---------- Contato ---------- */
  const wa = channels.find((c) => c.kind === "WHATSAPP");
  const probable = !!wa?.label?.startsWith("provável");

  /* ---------- Imagem e perfis (revisão visual) ---------- */
  const pending: string[] = [];
  const applicable: Record<VisualTarget, boolean> = {
    INSTAGRAM: has("INSTAGRAM"),
    WHATSAPP: !!wa && !probable,
    SITE: hasSite,
  };

  for (const target of Object.keys(applicable) as VisualTarget[]) {
    const review = visualReviews.find((r) => r.target === target);
    const answers = new Map((review?.answers ?? []).map((a) => [a.id, a]));

    if (answers.size === 0) {
      if (!applicable[target]) continue;

      pending.push(`Revisão visual: ${VISUAL_TARGET_LABEL[target]}`);
      checks.push(
        check(`visual.${target.toLowerCase()}`, "VISUAL", VISUAL_TARGET_LABEL[target], "UNKNOWN",
          "Não medido: faça a revisão visual (veja o perfil e responda o checklist, ou envie prints para a IA sugerir).",
          6, null),
      );
      continue;
    }

    for (const item of VISUAL_CHECKLIST[target]) {
      const answer = answers.get(item.id);

      checks.push(
        check(`visual.${target.toLowerCase()}.${item.id}`, "VISUAL",
          `${VISUAL_TARGET_LABEL[target]}: ${item.label}`,
          answer ? answer.status : "UNKNOWN",
          answer
            ? `${item.hints[answer.status]}${answer.note ? ` — ${answer.note}` : ""}`
            : "Não avaliado na revisão.",
          item.weight, item.service),
      );
    }
  }

  checks.push(
    check("contact.whatsapp", "CONTACT", "WhatsApp", !wa ? "FAIL" : probable ? "WARN" : "OK",
      !wa ? "Nenhum WhatsApp encontrado." : probable ? "Celular do Google, ainda não confirmado como WhatsApp." : "WhatsApp confirmado.",
      5, "SISTEMA_AUTOMACAO"),
    check("contact.phone", "CONTACT", "Telefone", has("PHONE") || !!company.phone ? "OK" : "FAIL",
      has("PHONE") || company.phone ? "Telefone disponível." : "Nenhum telefone encontrado.", 3),
    check("contact.email", "CONTACT", "E-mail", has("EMAIL") ? "OK" : "WARN",
      has("EMAIL") ? "E-mail encontrado." : "Nenhum e-mail encontrado.", 2),
  );

  /* ---------- Conversão e vendas ---------- */
  const text = `${company.segment ?? ""} ${company.category ?? ""}`;

  if (facts && !facts.error) {
    if (BOOKING.test(text)) {
      checks.push(
        check("conv.booking", "CONVERSION", "Agendamento online", facts.hasBooking ? "OK" : "WARN",
          facts.hasBooking ? "O site oferece agendamento." : "Não há agendamento online: o cliente precisa chamar para marcar.",
          5, "SISTEMA_AUTOMACAO"),
      );
    }

    if (RETAIL.test(text)) {
      checks.push(
        check("conv.shop", "CONVERSION", "Vende pela internet", facts.sellsOnline ? "OK" : "WARN",
          facts.sellsOnline ? "Há sinais de loja virtual." : "Sem sinais de loja virtual no site.",
          5, "SITE_LOJA"),
      );
    }
  }

  /* ---------- notas por dimensão ---------- */
  const dimensions: Dimension[] = (Object.keys(DIMENSION_META) as DimensionKey[]).map((key) => {
    const list = checks.filter((c) => c.dimension === key);
    const known = list.filter((c) => VALUE[c.status] !== null);
    const totalWeight = known.reduce((n, c) => n + c.weight, 0);
    const earned = known.reduce((n, c) => n + c.weight * (VALUE[c.status] as number), 0);

    return {
      key,
      ...DIMENSION_META[key],
      score: totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : null,
      checks: list,
    };
  });

  const scored = dimensions.filter((d) => d.score !== null);
  const weightSum = scored.reduce((n, d) => n + d.weight, 0);
  const rawScore = weightSum > 0
    ? Math.round(scored.reduce((n, d) => n + (d.score as number) * d.weight, 0) / weightSum)
    : null;

  // Confiança: quanto do peso total pôde ser medido (cada dimensão pesa o que pesa).
  // A dimensão visual só entra quando há algo a revisar (sem Instagram, WhatsApp nem site, não há o que olhar).
  const allWeight = dimensions
    .filter((d) => d.key !== "VISUAL" || d.checks.length > 0)
    .reduce((n, d) => n + d.weight, 0);
  const measured = dimensions.reduce((n, d) => {
    const list = d.checks;
    const total = list.reduce((a, c) => a + c.weight, 0);
    const known = list.filter((c) => VALUE[c.status] !== null).reduce((a, c) => a + c.weight, 0);

    return n + (total > 0 ? (known / total) * d.weight : 0);
  }, 0);
  // Site não lido pesa: a dimensão SITE só tem "tem site" medido, o resto some. Penaliza a confiança.
  const siteUnread = hasSite && (!facts || !!facts.error);
  const confidence = Math.max(0, Math.min(1, (measured / allWeight) * (siteUnread ? 0.5 : 1)));

  const noPresence = !hasSite && socials.length === 0;

  const score = rawScore;

  // Presença só é "avançada" se nada medido indicar site antigo ou imagem defasada:
  // ter HTTPS, celular e botão não compensa um site com cara de 2010 ou um Instagram sem banners.
  const DATED = ["site.legacy", "site.fresh", "site.psi", "visual.site.design", "visual.instagram.banners"];
  const dated = checks.filter((c) => DATED.includes(c.id) && c.status === "FAIL");

  const level: PresenceLevel = noPresence
    ? "NONE"
    : score === null || score < LEVEL_THRESHOLDS.BASIC
      ? "BASIC"
      : score < LEVEL_THRESHOLDS.INTERMEDIATE || dated.length > 0
        ? "INTERMEDIATE"
        : "ADVANCED";

  const gaps = checks
    .filter((c) => c.status === "FAIL" || c.status === "WARN")
    .sort(
      (a, b) =>
        Number(b.status === "FAIL") - Number(a.status === "FAIL") ||
        b.weight * (DIMENSION_META[b.dimension].weight / 100) - a.weight * (DIMENSION_META[a.dimension].weight / 100),
    );

  const strengths = checks
    .filter((c) => c.status === "OK")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  // O que vender: soma o peso das lacunas por serviço (FAIL pesa o dobro de WARN).
  const byService = new Map<ServiceKey, Offer>();

  for (const g of gaps) {
    if (!g.service) continue;

    const offer = byService.get(g.service) ?? { service: g.service, reasons: [], weight: 0 };
    offer.weight += g.weight * (g.status === "FAIL" ? 2 : 1);
    offer.reasons.push(`${g.label}: ${g.detail}`);
    byService.set(g.service, offer);
  }

  const offers = [...byService.values()]
    .sort((a, b) => b.weight - a.weight)
    .map((o) => ({ ...o, reasons: o.reasons.slice(0, 4) }));

  // Presença avançada sem lacunas de peso: o caminho é sistema/automação e suporte.
  if (level === "ADVANCED" && offers.length === 0) {
    offers.push({
      service: "SISTEMA_AUTOMACAO",
      reasons: ["Presença sólida: o ganho está em automatizar atendimento, agenda e relatórios."],
      weight: 1,
    });
  }

  const blockers: string[] = [];

  if (siteUnread) {
    blockers.push(
      facts?.error
        ? `O site não abriu (${facts.error}): confirme o endereço antes de abordar.`
        : "O site ainda não foi lido: rode o enriquecimento com a leitura do site.",
    );
  }

  if (confidence < 0.5 && !siteUnread) {
    blockers.push("Poucos dados medidos: complete a ficha de enriquecimento.");
  }

  const moment: SaleMoment =
    blockers.length > 0 && !noPresence
      ? "NEEDS_DATA"
      : offers.length > 0 && gaps.length > 0
        ? "READY"
        : "NO_GAP";

  const position = noPresence
    ? "Invisível na internet: depende do Google Maps e do boca a boca. Precisa existir online antes de qualquer otimização."
    : level === "BASIC"
      ? "Está online, mas de forma frágil: a base existe e falta estrutura para gerar contatos de forma previsível."
      : level === "INTERMEDIATE"
        ? dated.length > 0 && (score ?? 0) >= LEVEL_THRESHOLDS.INTERMEDIATE
          ? "Presença estruturada, mas com a imagem defasada (site antigo, lento ou banners e perfis fracos): espaço claro para modernizar e vender design."
          : "Boa base digital, com brechas claras na conversão e no atendimento que travam o crescimento."
        : "Presença forte: o espaço está em automatizar o que já funciona e em manter tudo evoluindo.";

  return {
    version: PRESENCE_VERSION,
    score,
    level,
    confidence: Math.round(confidence * 100) / 100,
    moment,
    position,
    dimensions,
    strengths,
    gaps,
    offers,
    blockers,
    notes: [
      "Instagram e WhatsApp não podem ser lidos automaticamente (as redes bloqueiam robôs e a API oficial exige aprovação da Meta): banners, feed e perfil vêm da revisão visual feita por você, com a IA só sugerindo a partir de prints.",
      "O tempo de resposta mede só o servidor; o teste do Google PageSpeed mede o carregamento no celular.",
      "Os sinais de site antigo vêm do código da página (tabelas, tags obsoletas, Flash, jQuery antigo); a aparência real é julgada na revisão visual.",
      "Ferramentas carregadas por JavaScript (chat, agendamento, analytics) podem não aparecer na leitura do código.",
    ],
    pending,
  };
}
