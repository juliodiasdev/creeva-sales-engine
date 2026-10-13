import type { Company } from "../companies/company.types";
import type { DetectedTool, ToolCategory, WebsiteFacts } from "../enrichment/website.facts";
import type { ServiceKey } from "../services/services.service";
import type { VisualReview } from "../visual/visual.checklist";
import { isGenericHost } from "../../lib/normalize";

/**
 * POTENCIAL DE AUTOMAÇÃO de uma empresa.
 *
 * Regra de verdade: cada linha diz de ONDE veio a informação (site, Google, sua revisão,
 * CNPJ, ou "típico do segmento") e o que NÃO dá para saber de fora vira pergunta, nunca
 * afirmação. "Não encontrado no site" é hipótese a confirmar: a empresa pode ter a
 * ferramenta em outro lugar. Sem IA, sem estimativa de economia, sem número inventado.
 */
export const AUTOMATION_VERSION = 1;

export type AutomationAreaKey =
  | "ATENDIMENTO"
  | "AGENDA"
  | "VENDAS"
  | "PAGAMENTO"
  | "CAPTACAO"
  | "AVALIACOES"
  | "GESTAO";

/**
 * ALREADY = encontramos a automação · CONFIRMED_GAP = você conferiu e não tem ·
 * NOT_FOUND = não encontramos (a confirmar) · UNKNOWN = não dá para saber de fora ·
 * NOT_APPLICABLE = sem sinal de que se aplica a esta empresa.
 */
export type AutomationState =
  | "ALREADY"
  | "CONFIRMED_GAP"
  | "NOT_FOUND"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export const STATE_LABEL: Record<AutomationState, string> = {
  ALREADY: "Já tem (encontrado)",
  CONFIRMED_GAP: "Falta (você conferiu)",
  NOT_FOUND: "Não encontrado (a confirmar)",
  UNKNOWN: "Não dá para saber de fora",
  NOT_APPLICABLE: "Sem sinal de que se aplica",
};

export type EvidenceSource = "SITE" | "GOOGLE" | "REVISAO" | "SEGMENTO" | "CNPJ";

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  SITE: "Site",
  GOOGLE: "Google",
  REVISAO: "Sua revisão",
  SEGMENTO: "Típico do segmento (não confirmado)",
  CNPJ: "CNPJ",
};

export interface AutomationEvidence {
  source: EvidenceSource;
  text: string;
}

export interface AutomationArea {
  key: AutomationAreaKey;
  label: string;
  state: AutomationState;
  evidence: AutomationEvidence[];
  /** O que perguntar à empresa para confirmar. */
  question: string;
  service: ServiceKey;
  weight: number;
}

export type AutomationLevel = "HIGH" | "MEDIUM" | "LOW" | "UNDEFINED";

export const AUTOMATION_LEVEL_LABEL: Record<AutomationLevel, string> = {
  HIGH: "Alto potencial de automação",
  MEDIUM: "Médio potencial de automação",
  LOW: "Baixo potencial de automação",
  UNDEFINED: "Potencial ainda não medido",
};

export interface AutomationReport {
  version: number;
  level: AutomationLevel;
  /** Frase com os fatos: o que foi encontrado, o que não, o que não dá para saber. */
  summary: string;
  /** Parcela das áreas aplicáveis que pôde ser verificada (0–1). */
  confidence: number;
  areas: AutomationArea[];
  notes: string[];
}

interface Input {
  company: Company;
  channels: { kind: string; value: string; label: string | null }[];
  facts: WebsiteFacts | null;
  reviews?: VisualReview[];
}

const BOOKING_SEGMENT =
  /(odont|dentist|cl[íi]nica|m[ée]dic|psic|fisio|nutri|est[ée]tica|beleza|sal[ãa]o|barbear|spa|advog|veterin|academia|studio|est[úu]dio|consult[óo]rio|manicure|massagem|personal|pilates)/i;

const RETAIL_SEGMENT =
  /(loja|moda|roupa|cal[çc]ado|joia|jóia|m[óo]vel|m[óo]veis|eletro|cosm[ée]tic|perfum|livraria|papelaria|presente|brinquedo|pet ?shop|farm[áa]cia|suplemento|mercado|com[ée]rcio|decora[çc]|autope[çc]|ótica|otica)/i;

const FOOD_SEGMENT =
  /(restaurante|lanchonete|pizzaria|hamburguer|padaria|confeitaria|doceria|a[çc]ougue|sorveteria|cafeteria|marmit|delivery|comida|a[çc]a[íi]|churrascaria|bar e)/i;

const RECURRING_SEGMENT =
  /(academia|escola|curso|idioma|col[ée]gio|condom[ií]nio|assinatura|mensalidade|personal|pilates|crossfit|nata[çc][ãa]o|dan[çc]a|creche|faculdade|escolinha|mensal)/i;

const tools = (facts: WebsiteFacts | null, category: ToolCategory): DetectedTool[] =>
  (facts?.tools ?? []).filter((t) => t.category === category);

const names = (list: DetectedTool[]) => list.map((t) => t.name).join(", ");

export function assessAutomation(input: Input): AutomationReport {
  const { company, channels, facts } = input;
  const reviews = input.reviews ?? [];
  const text = `${company.segment ?? ""} ${company.category ?? ""}`;

  const hasSite =
    (!!company.website && !isGenericHost(company.website)) ||
    channels.some((c) => c.kind === "WEBSITE");
  const siteRead = !!facts && !facts.error && (facts.httpStatus ?? 200) < 400;
  // Leituras antigas não tinham a lista de ferramentas: não dá para afirmar que não há nenhuma.
  const toolsKnown = siteRead && facts!.tools !== undefined;

  const answer = (target: "WHATSAPP" | "INSTAGRAM" | "SITE", id: string) =>
    reviews.find((r) => r.target === target)?.answers.find((a) => a.id === id);

  const gtm =
    siteRead && facts!.hasTagManager
      ? " A página usa Google Tag Manager, que pode carregar ferramentas que esta leitura não enxerga."
      : "";

  const unread: AutomationEvidence = {
    source: "SITE",
    text: !hasSite
      ? "Sem site próprio: não há o que ler."
      : facts?.error
        ? `O site não abriu (${facts.error}).`
        : "O site ainda não foi lido (rode o enriquecimento).",
  };

  const noSite: AutomationEvidence = {
    source: "SITE",
    text: "Sem site próprio encontrado: não há como ver ferramentas de automação (a empresa pode usar WhatsApp, Instagram ou outro canal).",
  };

  /** Estado de uma área que depende do que o código do site carrega. */
  const bySite = (
    found: boolean,
    notFoundText: string,
  ): { state: AutomationState; evidence: AutomationEvidence[] } => {
    if (found) return { state: "ALREADY", evidence: [] };

    // Sem site não há onde procurar: isso é "não dá para saber", nunca "não tem".
    if (!hasSite) return { state: "UNKNOWN", evidence: [noSite] };

    if (!toolsKnown) {
      return {
        state: "UNKNOWN",
        evidence: [siteRead ? { source: "SITE", text: "Leitura antiga do site, sem a lista de ferramentas (refaça o enriquecimento)." } : unread],
      };
    }

    return { state: "NOT_FOUND", evidence: [{ source: "SITE", text: `${notFoundText}${gtm}` }] };
  };

  const areas: AutomationArea[] = [];

  /* ---------- Atendimento (WhatsApp, chat) ---------- */
  {
    const chat = tools(facts, "CHAT");
    const wa = channels.find((c) => c.kind === "WHATSAPP");
    const reply = answer("WHATSAPP", "autoreply");
    const evidence: AutomationEvidence[] = [];

    if (wa) {
      evidence.push({
        source: wa.label?.startsWith("provável") ? "GOOGLE" : "SITE",
        text: wa.label?.startsWith("provável")
          ? "Há um celular que provavelmente é WhatsApp (ainda não confirmado)."
          : "Atendem por WhatsApp (canal encontrado).",
      });
    }

    if (chat.length > 0) {
      evidence.push({ source: "SITE", text: `Chat de atendimento encontrado no site: ${names(chat)}.` });
    }

    if (reply) {
      evidence.push({
        source: "REVISAO",
        text: `Mensagens automáticas no WhatsApp Business: ${reply.status === "OK" ? "configuradas" : reply.status === "WARN" ? "só parte configurada" : "nenhuma"}${reply.note ? ` (${reply.note})` : ""}.`,
      });
    }

    let state: AutomationState;

    if (reply && reply.status !== "OK") {
      state = "CONFIRMED_GAP";
    } else if (reply?.status === "OK" || chat.length > 0) {
      state = "ALREADY";
    } else {
      const site = bySite(false, "Não encontramos chat nem atendimento automático no código do site.");

      state = site.state;
      evidence.push(...site.evidence);

      if (wa) {
        evidence.push({
          source: "REVISAO",
          text: "Se o WhatsApp tem resposta automática, só a revisão do WhatsApp Business mostra.",
        });
      }
    }

    areas.push({
      key: "ATENDIMENTO",
      label: "Atendimento (WhatsApp e chat)",
      state,
      evidence,
      question:
        "Quem responde o WhatsApp e fora do horário? Têm mensagem automática, respostas rápidas ou catálogo?",
      service: "SISTEMA_AUTOMACAO",
      weight: 3,
    });
  }

  /* ---------- Agenda ---------- */
  {
    const booking = tools(facts, "BOOKING");
    const typical = BOOKING_SEGMENT.test(text);
    const evidence: AutomationEvidence[] = [];
    let state: AutomationState;

    if (typical) {
      evidence.push({ source: "SEGMENTO", text: `Segmentos como ${company.segment || company.category} costumam trabalhar com hora marcada.` });
    }

    if (facts?.hasBooking || booking.length > 0) {
      state = "ALREADY";
      evidence.push({
        source: "SITE",
        text: booking.length > 0
          ? `Ferramenta de agenda encontrada: ${names(booking)}.`
          : "O site oferece agendamento online.",
      });
    } else if (!typical) {
      state = "NOT_APPLICABLE";
    } else {
      const site = bySite(false, "Não encontramos agendamento online no código do site.");

      state = site.state;
      evidence.push(...site.evidence);
    }

    areas.push({
      key: "AGENDA",
      label: "Agenda e agendamento",
      state,
      evidence,
      question: "Como o cliente marca horário hoje? Alguém confirma e lembra do horário ou é tudo por conversa?",
      service: "SISTEMA_AUTOMACAO",
      weight: 3,
    });
  }

  /* ---------- Vendas e pedidos ---------- */
  {
    const shop = tools(facts, "ECOMMERCE");
    const delivery = tools(facts, "DELIVERY");
    const typical = RETAIL_SEGMENT.test(text) || FOOD_SEGMENT.test(text);
    const sells = !!facts?.sellsOnline || shop.length > 0 || delivery.length > 0;
    const evidence: AutomationEvidence[] = [];
    let state: AutomationState;

    if (typical) {
      evidence.push({ source: "SEGMENTO", text: `Segmentos como ${company.segment || company.category} costumam vender produtos ou receber pedidos.` });
    }

    if (sells) {
      state = "ALREADY";
      evidence.push({
        source: "SITE",
        text: [
          shop.length > 0 ? `Plataforma de loja encontrada: ${names(shop)}` : null,
          delivery.length > 0 ? `Canal de pedidos encontrado: ${names(delivery)}` : null,
          shop.length === 0 && delivery.length === 0 ? "Há sinais de venda online no site (carrinho/compra)" : null,
        ].filter(Boolean).join(". ") + ".",
      });
    } else if (!typical) {
      state = "NOT_APPLICABLE";
    } else {
      const site = bySite(false, "Não encontramos loja virtual, cardápio nem pedido online no código do site.");

      state = site.state;
      evidence.push(...site.evidence);
    }

    areas.push({
      key: "VENDAS",
      label: "Vendas e pedidos online",
      state,
      evidence,
      question: "Hoje o cliente consegue comprar ou pedir sem falar com alguém? Por onde chegam os pedidos?",
      service: "SITE_LOJA",
      weight: 3,
    });
  }

  /* ---------- Pagamento e cobrança ---------- */
  {
    const pay = tools(facts, "PAYMENT");
    const shop = tools(facts, "ECOMMERCE");
    const recurring = RECURRING_SEGMENT.test(text);
    const sells = !!facts?.sellsOnline || shop.length > 0;
    const evidence: AutomationEvidence[] = [];
    let state: AutomationState;

    if (recurring) {
      evidence.push({ source: "SEGMENTO", text: `Segmentos como ${company.segment || company.category} costumam cobrar mensalidade ou assinatura.` });
    }

    if (sells) {
      evidence.push({ source: "SITE", text: `Há sinais de venda online${shop.length > 0 ? ` (${names(shop)})` : ""}.` });
    }

    if (pay.length > 0) {
      state = "ALREADY";
      evidence.push({ source: "SITE", text: `Meio de pagamento online encontrado: ${names(pay)}.` });
    } else if (!recurring && !sells) {
      state = "NOT_APPLICABLE";
    } else {
      const site = bySite(false, "Não encontramos meio de pagamento online (Mercado Pago, PagBank, Stripe…) no código do site.");

      state = site.state;
      evidence.push(...site.evidence);
    }

    areas.push({
      key: "PAGAMENTO",
      label: "Pagamento e cobrança",
      state,
      evidence,
      question: "Como o cliente paga e como vocês cobram (PIX, link, boleto, maquininha)? Quem lembra de quem está em atraso?",
      service: "SISTEMA_AUTOMACAO",
      weight: 2,
    });
  }

  /* ---------- Captação e acompanhamento de contatos ---------- */
  {
    const crm = tools(facts, "CRM");
    const evidence: AutomationEvidence[] = [];
    let state: AutomationState;

    if (crm.length > 0) {
      state = "ALREADY";
      evidence.push({ source: "SITE", text: `Ferramenta de CRM/e-mail marketing encontrada: ${names(crm)}.` });
    } else {
      if (siteRead) {
        evidence.push({
          source: "SITE",
          text: facts!.formsCount > 0 ? `O site tem ${facts!.formsCount} formulário(s).` : "O site não tem formulário.",
        });
      }

      const site = bySite(false, "Não encontramos ferramenta de CRM ou e-mail marketing (RD Station, HubSpot, Mailchimp…) no código do site.");

      state = site.state;
      evidence.push(...site.evidence);
    }

    areas.push({
      key: "CAPTACAO",
      label: "Captação e acompanhamento de contatos",
      state,
      evidence,
      question: "O que acontece com quem pede informação e não fecha na hora? Existe lista de contatos e retorno programado?",
      service: "SISTEMA_AUTOMACAO",
      weight: 2,
    });
  }

  /* ---------- Avaliações e pós-venda ---------- */
  {
    const reviewsCount = company.reviews_count ?? 0;
    const rating = company.rating;
    const strong = reviewsCount >= 100 && (rating ?? 0) >= 4.3;
    const evidence: AutomationEvidence[] = [
      {
        source: "GOOGLE",
        text: `${reviewsCount} avaliação(ões) no Google${rating != null ? `, nota ${rating}` : ""}.`,
      },
    ];

    areas.push({
      key: "AVALIACOES",
      label: "Avaliações e pós-venda",
      state: strong ? "NOT_APPLICABLE" : "UNKNOWN",
      evidence,
      question: "Pedem avaliação aos clientes depois do atendimento? É feito de forma sistemática?",
      service: "SISTEMA_AUTOMACAO",
      weight: 1,
    });
  }

  /* ---------- Gestão interna (só a empresa sabe) ---------- */
  {
    const evidence: AutomationEvidence[] = [];

    if ((company.reviews_count ?? 0) >= 100) {
      evidence.push({ source: "GOOGLE", text: `${company.reviews_count} avaliações no Google indicam volume de clientes.` });
    }

    if (company.company_size) {
      evidence.push({ source: "CNPJ", text: `Porte no CNPJ: ${company.company_size}.` });
    }

    areas.push({
      key: "GESTAO",
      label: "Gestão interna (clientes, agenda, financeiro, relatórios)",
      state: "UNKNOWN",
      evidence,
      question: "Como controlam clientes, agenda e financeiro hoje (planilha, caderno, sistema)? Quanto tempo isso toma da equipe?",
      service: "SISTEMA_AUTOMACAO",
      weight: 1,
    });
  }

  const applicable = areas.filter((a) => a.state !== "NOT_APPLICABLE");
  const checked = applicable.filter((a) => a.state === "ALREADY" || a.state === "CONFIRMED_GAP" || a.state === "NOT_FOUND");
  const gaps = applicable.filter((a) => a.state === "CONFIRMED_GAP" || a.state === "NOT_FOUND");
  const already = applicable.filter((a) => a.state === "ALREADY");
  const unknown = applicable.filter((a) => a.state === "UNKNOWN");
  const gapWeight = gaps.reduce((n, a) => n + a.weight, 0);

  const level: AutomationLevel =
    checked.length === 0
      ? "UNDEFINED"
      : gapWeight >= 6
        ? "HIGH"
        : gapWeight >= 3
          ? "MEDIUM"
          : "LOW";

  const list = (items: AutomationArea[]) => items.map((a) => a.label.replace(/ \(.*\)$/, "")).join(", ");

  const summary = [
    already.length > 0 ? `Automação encontrada em: ${list(already)}.` : null,
    gaps.length > 0 ? `Sem automação encontrada em: ${list(gaps)} (a confirmar com a empresa).` : null,
    unknown.length > 0 ? `Não dá para saber de fora: ${list(unknown)}.` : null,
    checked.length === 0 ? "Ainda não há como medir: leia o site (enriquecer) e faça a revisão do WhatsApp." : null,
  ].filter(Boolean).join(" ");

  return {
    version: AUTOMATION_VERSION,
    level,
    summary,
    confidence: applicable.length > 0 ? Math.round((checked.length / applicable.length) * 100) / 100 : 0,
    areas,
    notes: [
      "'Não encontrado' não prova que a empresa não tem: ela pode usar agenda, atendimento ou cobrança por outro canal. Por isso é uma hipótese para confirmar na conversa.",
      "Linhas 'Típico do segmento' vêm do tipo de negócio, não de um fato sobre esta empresa.",
      "O app não estima economia, horas poupadas nem retorno: esses números só a empresa tem.",
    ],
  };
}

/** Áreas com automação ausente (confirmada ou não encontrada), da mais pesada para a mais leve. */
export const automationGaps = (report: AutomationReport): AutomationArea[] =>
  report.areas
    .filter((a) => a.state === "CONFIRMED_GAP" || a.state === "NOT_FOUND")
    .sort((a, b) => b.weight - a.weight);

/** Motivo de oferta para uma área: deixa claro o que é fato e o que é hipótese. */
export function automationReason(area: AutomationArea): string {
  const facts = area.evidence.map((e) => e.text).join(" ");

  return `${area.label}: ${facts}${area.state === "NOT_FOUND" ? " (a confirmar)" : ""}`;
}
