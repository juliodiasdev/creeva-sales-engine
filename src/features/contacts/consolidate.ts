import type { StoredChannel } from "./channels.repository";
import type { ChannelKind } from "./channels.engine";

export interface ConsolidatedChannels {
  /** Um contato por tipo: o que o vendedor realmente usa. */
  main: StoredChannel[];
  /** Demais contatos reais (outros números/e-mails), sem repetições. */
  extra: StoredChannel[];
}

const ORDER: ChannelKind[] = [
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "WEBSITE",
];

const rank = (c: StoredChannel): number => {
  // Confirmado no site > dado do Google > demais.
  if (c.label?.startsWith("confirmado")) return 0;
  if (c.source === "GOOGLE_PLACES") return 1;
  if (c.source === "MANUAL") return 1;
  return 2;
};

/**
 * Remove repetições (o mesmo número como WhatsApp e Telefone, o mesmo
 * valor vindo de fontes diferentes) e escolhe UM contato principal por tipo.
 * Nenhum dado é inventado: só reorganiza o que foi coletado.
 */
export function consolidateChannels(
  channels: StoredChannel[],
): ConsolidatedChannels {
  const sorted = [...channels].sort(
    (a, b) =>
      ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || rank(a) - rank(b),
  );

  // Números que já aparecem como WhatsApp não repetem como Telefone.
  const whatsappNumbers = new Set(
    sorted.filter((c) => c.kind === "WHATSAPP").map((c) => c.value),
  );

  const seen = new Set<string>();
  const unique: StoredChannel[] = [];

  for (const c of sorted) {
    if (c.kind === "PHONE" && whatsappNumbers.has(c.value)) continue;

    const key = `${c.kind}:${c.value.toLowerCase()}`;

    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(c);
  }

  const main: StoredChannel[] = [];
  const extra: StoredChannel[] = [];
  const taken = new Set<ChannelKind>();

  for (const c of unique) {
    if (taken.has(c.kind)) {
      extra.push(c);
    } else {
      taken.add(c.kind);
      main.push(c);
    }
  }

  return { main, extra };
}
