import {
  isMobilePhone,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  socialProfile,
  whatsappNumberFromUrl,
} from "../../lib/normalize";

import type { WebsiteFacts } from "../enrichment/website.facts";

export type ChannelKind =
  | "WHATSAPP"
  | "PHONE"
  | "EMAIL"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK"
  | "WEBSITE";

export type ChannelSource =
  | "GOOGLE_PLACES"
  | "WEBSITE"
  | "MANUAL";

export interface ChannelInput {
  kind: ChannelKind;
  /** Identificador normalizado (dígitos, e-mail, @perfil, domínio). */
  value: string;
  url: string;
  label: string | null;
  source: ChannelSource;
}

export interface ChannelCompany {
  website: string | null;
  phone: string | null;
  instagram: string | null;
}

/**
 * Monta os canais de contato a partir de dados REAIS (Google, site).
 * Nada é inventado: celular sem confirmação é marcado como "provável".
 * A ordem importa: itens confirmados vêm antes e vencem no dedupe.
 */
export function buildChannels(
  company: ChannelCompany,
  facts: WebsiteFacts | null,
): ChannelInput[] {
  const out: ChannelInput[] = [];
  const seen = new Set<string>();

  const add = (c: ChannelInput) => {
    const key = `${c.kind}:${c.value}`;

    if (seen.has(key)) return;

    seen.add(key);
    out.push(c);
  };

  // 1) WhatsApp confirmado no site
  for (const link of facts?.whatsappLinks ?? []) {
    const number = whatsappNumberFromUrl(link);

    if (number) {
      add({
        kind: "WHATSAPP",
        value: number,
        url: `https://wa.me/55${number}`,
        label: "confirmado no site",
        source: "WEBSITE",
      });
    }
  }

  // 2) telefones (Google primeiro, depois site)
  const phones: [string | null, ChannelSource][] = [
    [company.phone, "GOOGLE_PLACES"],
    ...((facts?.phones ?? []).map((p) => [p, "WEBSITE"] as [string, ChannelSource])),
  ];

  for (const [raw, source] of phones) {
    const phone = normalizePhone(raw);

    if (!phone) continue;

    add({
      kind: "PHONE",
      value: phone,
      url: `tel:+55${phone}`,
      label: null,
      source,
    });

    if (isMobilePhone(phone)) {
      add({
        kind: "WHATSAPP",
        value: phone,
        url: `https://wa.me/55${phone}`,
        label: "provável (celular)",
        source,
      });
    }
  }

  // 3) e-mails
  for (const raw of facts?.emails ?? []) {
    const email = normalizeEmail(raw);

    if (email) {
      add({
        kind: "EMAIL",
        value: email,
        url: `mailto:${email}`,
        label: null,
        source: "WEBSITE",
      });
    }
  }

  // 4) redes sociais (site + campo instagram do cadastro)
  const socialLinks = [
    ...Object.values(facts?.socialLinks ?? {}),
    ...(company.instagram ? [company.instagram] : []),
  ];

  for (const link of socialLinks) {
    const profile = socialProfile(
      link.startsWith("@") ? `instagram.com/${link.slice(1)}` : link,
    );

    if (profile) {
      add({
        kind: profile.kind,
        value: profile.handle,
        url: profile.url,
        label: null,
        source: link === company.instagram ? "MANUAL" : "WEBSITE",
      });
    }
  }

  // 5) site
  const domain = normalizeDomain(company.website);

  if (domain && company.website) {
    add({
      kind: "WEBSITE",
      value: domain,
      url: /^https?:\/\//i.test(company.website)
        ? company.website
        : `https://${company.website}`,
      label: null,
      source: "GOOGLE_PLACES",
    });
  }

  return out;
}

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  WHATSAPP: "WhatsApp",
  PHONE: "Telefone",
  EMAIL: "E-mail",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  WEBSITE: "Site",
};

/** Link para abrir o canal; WhatsApp e e-mail levam a mensagem pronta. */
export function channelOpenUrl(
  channel: { kind: ChannelKind; value: string; url: string | null },
  message?: string,
  subject?: string,
): string {
  switch (channel.kind) {
    case "WHATSAPP":
      return `https://wa.me/55${channel.value}${
        message ? `?text=${encodeURIComponent(message)}` : ""
      }`;
    case "PHONE":
      return `tel:+55${channel.value}`;
    case "EMAIL": {
      const params = new URLSearchParams();

      if (subject) params.set("subject", subject);
      if (message) params.set("body", message);

      const query = params.toString().replace(/\+/g, "%20");

      return `mailto:${channel.value}${query ? `?${query}` : ""}`;
    }
    default:
      return channel.url ?? "";
  }
}
