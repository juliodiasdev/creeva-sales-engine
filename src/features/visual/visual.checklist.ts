import type { ServiceKey } from "../services/services.service";

/**
 * Revisão VISUAL de uma empresa: o que o app não consegue ler sozinho.
 *
 * Instagram e WhatsApp não têm leitura automática aberta (as redes bloqueiam
 * robôs e a API oficial exige aprovação da Meta). Por isso a avaliação é feita
 * por um checklist fixo: o vendedor olha o perfil e responde — ou envia prints e
 * a IA SUGERE as respostas, que o vendedor confere antes de salvar.
 */
export type VisualTarget = "INSTAGRAM" | "WHATSAPP" | "SITE";

export type VisualStatus = "OK" | "WARN" | "FAIL";

export const VISUAL_TARGETS: VisualTarget[] = ["INSTAGRAM", "WHATSAPP", "SITE"];

export const VISUAL_TARGET_LABEL: Record<VisualTarget, string> = {
  INSTAGRAM: "Instagram",
  WHATSAPP: "WhatsApp Business",
  SITE: "Visual do site",
};

export interface ChecklistItem {
  id: string;
  label: string;
  /** Pergunta que o vendedor (ou a IA) responde olhando o perfil. */
  question: string;
  /** O que cada resposta significa, para a escolha ser objetiva. */
  hints: Record<VisualStatus, string>;
  weight: number;
  /** Serviço da Creava que resolve a lacuna. */
  service: ServiceKey;
}

export const VISUAL_CHECKLIST: Record<VisualTarget, ChecklistItem[]> = {
  INSTAGRAM: [
    {
      id: "avatar",
      label: "Foto de perfil",
      question: "A foto de perfil é o logo ou uma imagem profissional da marca?",
      hints: {
        OK: "Logo nítido e reconhecível",
        WARN: "Foto genérica, cortada ou de baixa qualidade",
        FAIL: "Sem foto ou foto que não representa a empresa",
      },
      weight: 2,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "bio",
      label: "Bio e informações",
      question: "A bio diz o que a empresa faz, onde fica e como falar com ela?",
      hints: {
        OK: "Bio clara, com o que faz, onde fica e contato",
        WARN: "Bio incompleta ou confusa",
        FAIL: "Bio vazia ou sem informação útil",
      },
      weight: 2,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "link",
      label: "Link e botão de contato",
      question: "Tem link na bio (WhatsApp, site, cardápio) ou botão de contato?",
      hints: {
        OK: "Link ou botão de contato funcionando",
        WARN: "Link genérico ou difícil de achar",
        FAIL: "Nenhum caminho para falar com a empresa",
      },
      weight: 2,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "identity",
      label: "Identidade visual do feed",
      question: "O feed tem cores, fontes e estilo consistentes entre os posts?",
      hints: {
        OK: "Feed harmonioso, com cara de marca",
        WARN: "Alguma consistência, mas misturado",
        FAIL: "Sem padrão: cada post de um jeito",
      },
      weight: 3,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "banners",
      label: "Banners e artes de divulgação",
      question:
        "Há artes profissionais de promoções, produtos ou serviços, com aparência atual?",
      hints: {
        OK: "Artes profissionais e atuais",
        WARN: "Artes antigas, desalinhadas ou amadoras",
        FAIL: "Não há banners nem artes (só fotos soltas ou nada)",
      },
      weight: 5,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "recency",
      label: "Frequência de postagens",
      question: "Quando foi o último post?",
      hints: {
        OK: "Postou nos últimos 30 dias",
        WARN: "Último post entre 30 e 90 dias atrás",
        FAIL: "Parado há mais de 90 dias",
      },
      weight: 3,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "highlights",
      label: "Destaques dos stories",
      question: "Os destaques (stories fixos) existem e estão organizados com capas?",
      hints: {
        OK: "Destaques organizados, com capas",
        WARN: "Destaques sem capa ou desorganizados",
        FAIL: "Sem destaques",
      },
      weight: 1,
      service: "DESIGN_SOCIAL",
    },
  ],

  WHATSAPP: [
    {
      id: "business",
      label: "Conta WhatsApp Business",
      question: "O número usa o WhatsApp Business (perfil comercial), e não o pessoal?",
      hints: {
        OK: "Perfil comercial (WhatsApp Business)",
        WARN: "Perfil comercial, mas com poucos dados preenchidos",
        FAIL: "WhatsApp pessoal, sem perfil comercial",
      },
      weight: 3,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "photo",
      label: "Foto ou logo do perfil",
      question: "A foto do perfil é o logo ou uma imagem profissional?",
      hints: {
        OK: "Logo nítido",
        WARN: "Foto genérica ou de baixa qualidade",
        FAIL: "Sem foto ou foto pessoal sem relação com a empresa",
      },
      weight: 2,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "profile",
      label: "Perfil comercial preenchido",
      question: "Tem descrição, endereço, horário de atendimento e site/Instagram no perfil?",
      hints: {
        OK: "Perfil completo",
        WARN: "Perfil com informações faltando",
        FAIL: "Perfil vazio",
      },
      weight: 3,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "catalog",
      label: "Catálogo de produtos ou serviços",
      question: "Tem catálogo no WhatsApp com fotos e descrições?",
      hints: {
        OK: "Catálogo organizado e com boas fotos",
        WARN: "Catálogo incompleto ou com fotos fracas",
        FAIL: "Sem catálogo",
      },
      weight: 2,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "autoreply",
      label: "Mensagens automáticas",
      question: "Tem mensagem de saudação, de ausência ou respostas rápidas?",
      hints: {
        OK: "Saudação e/ou respostas rápidas configuradas",
        WARN: "Só uma delas",
        FAIL: "Nenhuma mensagem automática",
      },
      weight: 3,
      service: "SISTEMA_AUTOMACAO",
    },
  ],

  SITE: [
    {
      id: "design",
      label: "Aparência geral",
      question: "O visual (layout, tipografia, espaçamento) parece atual ou datado?",
      hints: {
        OK: "Moderno e limpo",
        WARN: "Funcional, mas com cara de alguns anos atrás",
        FAIL: "Datado ou confuso, com cara de site antigo",
      },
      weight: 5,
      service: "SITE_LOJA",
    },
    {
      id: "hero",
      label: "Banner principal (topo da página)",
      question: "O primeiro banner ou imagem do site é profissional e comunica a oferta?",
      hints: {
        OK: "Banner profissional, com oferta clara",
        WARN: "Imagem genérica, de baixa qualidade ou sem mensagem",
        FAIL: "Sem banner nem imagem de destaque",
      },
      weight: 4,
      service: "DESIGN_SOCIAL",
    },
    {
      id: "consistency",
      label: "Coerência com o Instagram",
      question: "O site e o Instagram parecem da mesma marca (logo, cores)?",
      hints: {
        OK: "Mesma identidade nos dois",
        WARN: "Parecidos, mas com diferenças",
        FAIL: "Parecem empresas diferentes",
      },
      weight: 2,
      service: "DESIGN_SOCIAL",
    },
  ],
};

export interface VisualAnswer {
  id: string;
  status: VisualStatus;
  /** O que foi visto (evidência curta). */
  note?: string;
}

/** Medição objetiva do Google PageSpeed (celular). */
export interface SiteMetrics {
  strategy: "mobile";
  /** 0–100 */
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  /** Tempo até o maior conteúdo aparecer (ms). */
  lcpMs: number | null;
  measuredAt: string;
}

/** MANUAL = o vendedor respondeu · AI_ASSISTED = a IA sugeriu e o vendedor conferiu */
export type VisualSource = "MANUAL" | "AI_ASSISTED";

export interface VisualReview {
  target: VisualTarget;
  answers: VisualAnswer[];
  metrics: SiteMetrics | null;
  summary: string | null;
  source: VisualSource;
  reviewedAt: string;
}

export const itemOf = (target: VisualTarget, id: string): ChecklistItem | undefined =>
  VISUAL_CHECKLIST[target].find((i) => i.id === id);
