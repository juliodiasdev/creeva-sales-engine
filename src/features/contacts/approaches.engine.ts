import type { ServiceKey } from "../services/services.service";
import type { ServiceMatch } from "../services/offers.engine";
import type { SignalType } from "../signals/signals.engine";
import type { ChannelKind } from "./channels.engine";

export type ApproachChannel =
  | "WHATSAPP"
  | "INSTAGRAM"
  | "EMAIL"
  | "PHONE"
  | "LINKEDIN";

export interface Approach {
  channel: ApproachChannel;
  service_key: ServiceKey | null;
  angle: string;
  message: string;
  evidence_used: SignalType[];
}

export const APPROACH_CHANNELS: ApproachChannel[] = [
  "WHATSAPP",
  "INSTAGRAM",
  "EMAIL",
  "PHONE",
  "LINKEDIN",
];

/** Observação em linguagem natural por sinal (só quando há evidência). */
const OBSERVATION: Partial<Record<SignalType, string>> = {
  NO_WEBSITE: "não encontrei um site da empresa",
  BROKEN_LINK: "o site da empresa não estava carregando quando tentei acessar",
  NO_HTTPS: "o site abre sem o cadeado de segurança (HTTPS)",
  NO_MOBILE_SIGNAL: "o site pode não estar bem adaptado ao celular",
  OUTDATED_COPYRIGHT: "o site parece não receber atualizações há um tempo",
  WEAK_CONVERSION_PATH: "o caminho até o contato/agendamento no site está pouco destacado",
  NO_CLEAR_CTA: "não achei um botão claro de agendamento ou orçamento no site",
  NO_FORM: "o site não tem um formulário de contato",
  NO_WHATSAPP: "não vi um botão de WhatsApp no site",
};

const OFFER: Record<ServiceKey, { angle: string; pitch: string }> = {
  LANDING_PAGE: {
    angle: "Captar mais contatos com uma página focada em conversão",
    pitch: "criamos páginas objetivas que transformam visitas em contatos e apoiam campanhas",
  },
  SITE_LOJA: {
    angle: "Presença digital profissional (site ou loja virtual)",
    pitch: "fazemos sites e lojas virtuais rápidos, seguros e preparados para vender",
  },
  SOFTWARE_APP: {
    angle: "Software ou aplicativo sob medida para a operação",
    pitch: "desenvolvemos softwares e aplicativos sob medida para o jeito que a sua empresa trabalha",
  },
  SISTEMA_AUTOMACAO: {
    angle: "Sistema/automação para reduzir tarefas manuais",
    pitch: "montamos sistemas e automações que tiram do braço tarefas repetitivas (agenda, cobrança, atendimento, relatórios)",
  },
  SUPORTE: {
    angle: "Suporte contínuo para manter tudo atualizado",
    pitch: "cuidamos de ajustes, atualizações e acompanhamento depois da entrega",
  },
};

function observationFor(match: ServiceMatch | undefined): {
  text: string | null;
  used: SignalType[];
} {
  if (!match) return { text: null, used: [] };

  for (const signal of match.signals) {
    const text = OBSERVATION[signal];

    if (text) return { text, used: [signal] };
  }

  return { text: null, used: [] };
}

export interface ApproachInput {
  companyName: string;
  segment: string | null;
  matches: ServiceMatch[];
  availableChannels: ChannelKind[];
  agency: string;
  seller: string;
}

/**
 * Abordagens por canal geradas por TEMPLATE (sem IA). Só cita uma
 * observação quando existe sinal com evidência; caso contrário a
 * mensagem é neutra. O usuário revisa antes de enviar.
 */
export function buildTemplateApproaches(input: ApproachInput): Approach[] {
  const top = input.matches[0];
  const offer = top ? OFFER[top.key] : null;
  const { text: observation, used } = observationFor(top);

  const sender = input.seller
    ? `${input.seller}, da ${input.agency}`
    : `da ${input.agency}`;

  const hook = observation
    ? `Dei uma olhada na presença digital da ${input.companyName} e ${observation}.`
    : `Conheci a ${input.companyName} e achei interessante o trabalho de vocês.`;

  const pitch = offer
    ? `Na ${input.agency}, ${offer.pitch}.`
    : `Na ${input.agency}, desenvolvemos soluções digitais sob medida para empresas.`;

  const angle = offer?.angle ?? "Apresentação geral das soluções digitais";

  const base = (greeting: string, closing: string) =>
    [greeting, "", hook, pitch, "", closing].join("\n");

  const has = (k: ChannelKind) => input.availableChannels.includes(k);
  const out: Approach[] = [];

  const push = (channel: ApproachChannel, message: string) =>
    out.push({
      channel,
      service_key: top?.key ?? null,
      angle,
      message,
      evidence_used: used,
    });

  if (has("WHATSAPP")) {
    push(
      "WHATSAPP",
      base(
        `Olá! Tudo bem? Aqui é ${sender}.`,
        "Posso te mostrar rapidamente como isso poderia funcionar para vocês?",
      ),
    );
  }

  if (has("INSTAGRAM")) {
    push(
      "INSTAGRAM",
      base(
        "Olá! Tudo bem?",
        "Se fizer sentido, te explico em poucas linhas por aqui. 🙂",
      ),
    );
  }

  if (has("EMAIL")) {
    push(
      "EMAIL",
      base(
        `Olá, tudo bem? Meu nome é ${input.seller || "da equipe"} e escrevo em nome da ${input.agency}.`,
        "Se houver interesse, posso agendar uma conversa de 15 minutos. Fico à disposição.",
      ),
    );
  }

  if (has("PHONE")) {
    push(
      "PHONE",
      [
        `Roteiro de ligação — ${input.companyName}`,
        `1. Apresentação: "Olá, aqui é ${sender}."`,
        `2. Motivo: ${observation ? `"Vi que ${observation}."` : '"Conheci a empresa de vocês e queria entender como captam clientes hoje."'}`,
        `3. Oferta: "${pitch}"`,
        '4. Pergunta: "Quem cuida disso por aí? Posso enviar mais detalhes pelo WhatsApp?"',
      ].join("\n"),
    );
  }

  if (has("LINKEDIN")) {
    push(
      "LINKEDIN",
      base(
        "Olá! Vi o perfil da empresa e gostaria de me conectar.",
        "Podemos trocar uma ideia rápida?",
      ),
    );
  }

  return out;
}
