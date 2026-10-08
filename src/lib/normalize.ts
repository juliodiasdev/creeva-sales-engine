/** Helpers de normalização usados na deduplicação. */

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeText(
  value: string | null | undefined,
): string {
  return stripAccents(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Domínio sem protocolo, "www." nem caminho. Null se inválido. */
export function normalizeDomain(
  url: string | null | undefined,
): string | null {
  const raw = url?.trim();

  if (!raw) return null;

  try {
    const host = new URL(
      /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`,
    ).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

/** Telefone BR só com dígitos, sem DDI 55. Null se curto demais. */
export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");

  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  digits = digits.replace(/^0+/, "");

  return digits.length >= 10 && digits.length <= 11
    ? digits
    : null;
}

export function normalizeCnpj(
  cnpj: string | null | undefined,
): string | null {
  const digits = (cnpj ?? "").replace(/\D/g, "");

  return digits.length === 14 ? digits : null;
}

/** Chave nome + endereço (ou cidade quando não há endereço). */
export function buildDedupeKey(
  name: string,
  address?: string | null,
  city?: string | null,
): string | null {
  const n = normalizeText(name);
  const place = normalizeText(address || city);

  return n && place ? `${n}|${place}` : null;
}

/* ---------- contatos e redes sociais ---------- */

/** Celular BR (DDD + 9 + 8 dígitos): normalmente tem WhatsApp. */
export function isMobilePhone(normalized: string | null): boolean {
  return !!normalized && normalized.length === 11 && normalized[2] === "9";
}

/** Extrai o número de links do WhatsApp (wa.me, api/web.whatsapp.com...). */
export function whatsappNumberFromUrl(href: string): string | null {
  try {
    const url = new URL(href.startsWith("whatsapp:") ? href.replace("whatsapp://", "https://wa.example/") : href);

    if (/(^|\.)wa\.me$/i.test(url.hostname)) {
      return normalizePhone(url.pathname.replace(/\//g, ""));
    }

    const phone = url.searchParams.get("phone");

    return phone ? normalizePhone(phone) : null;
  } catch {
    return null;
  }
}

const JUNK_EMAIL =
  /(\.(png|jpe?g|gif|svg|webp|css|js)$|^(no-?reply|noreply|donotreply)@|@(example|sentry|wixpress|domain|email)\.)/i;

export function normalizeEmail(
  value: string | null | undefined,
): string | null {
  const email = (value ?? "").trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];

  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;

  return JUNK_EMAIL.test(email) ? null : email;
}

export type SocialKind =
  | "INSTAGRAM"
  | "FACEBOOK"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK";

const RESERVED: Record<SocialKind, string[]> = {
  INSTAGRAM: ["p", "reel", "reels", "explore", "accounts", "stories", "tv", "share"],
  FACEBOOK: ["sharer", "sharer.php", "plugins", "tr", "dialog", "share", "share.php", "login", "groups", "events", "watch"],
  LINKEDIN: ["share", "sharing", "feed", "login", "signup"],
  YOUTUBE: ["watch", "embed", "playlist", "results", "feed", "shorts"],
  TIKTOK: ["video", "tag", "discover"],
};

/** Perfil canônico de uma rede social a partir de um link; null se não for um perfil. */
export function socialProfile(
  href: string,
): { kind: SocialKind; handle: string; url: string } | null {
  let url: URL;

  try {
    url = new URL(/^[a-z]+:\/\//i.test(href) ? href : `https://${href}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m|pt-br|web)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  const kind: SocialKind | null = /(^|\.)instagram\.com$/.test(host)
    ? "INSTAGRAM"
    : /(^|\.)(facebook|fb)\.com$/.test(host)
      ? "FACEBOOK"
      : /(^|\.)linkedin\.com$/.test(host)
        ? "LINKEDIN"
        : /(^|\.)(youtube\.com|youtu\.be)$/.test(host)
          ? "YOUTUBE"
          : /(^|\.)tiktok\.com$/.test(host)
            ? "TIKTOK"
            : null;

  if (!kind || parts.length === 0) return null;

  let first = parts[0];
  let handle = first;

  if (kind === "LINKEDIN") {
    if (!["company", "in", "school"].includes(first) || !parts[1]) return null;
    handle = `${first}/${parts[1]}`;
  } else if (kind === "YOUTUBE") {
    if (first.startsWith("@")) handle = first;
    else if (["channel", "c", "user"].includes(first) && parts[1]) handle = `${first}/${parts[1]}`;
    else return null;
  } else if (kind === "FACEBOOK" && first === "profile.php") {
    const id = url.searchParams.get("id");
    if (!id) return null;
    handle = `profile.php?id=${id}`;
  } else {
    first = first.toLowerCase();
    if (RESERVED[kind].includes(first)) return null;
    handle = first.replace(/^@/, "");
  }

  handle = handle.toLowerCase();

  const canonical: Record<SocialKind, string> = {
    INSTAGRAM: `https://www.instagram.com/${handle}/`,
    FACEBOOK: `https://www.facebook.com/${handle}`,
    LINKEDIN: `https://www.linkedin.com/${handle}`,
    YOUTUBE: `https://www.youtube.com/${handle}`,
    TIKTOK: `https://www.tiktok.com/@${handle}`,
  };

  return { kind, handle, url: canonical[kind] };
}
