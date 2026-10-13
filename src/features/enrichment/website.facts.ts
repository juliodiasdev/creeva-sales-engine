import * as cheerio from "cheerio";

import { normalizeEmail, socialProfile } from "../../lib/normalize";

export interface WebsiteFacts {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  https: boolean;
  error: string | null;

  title: string | null;
  description: string | null;
  headings: string[];

  linkCount: number;
  phones: string[];
  emails: string[];
  contactPageUrl: string | null;
  whatsappLinks: string[];
  ctas: string[];
  formsCount: number;
  socialLinks: Record<string, string>;
  copyrightYear: number | null;
  hasViewport: boolean;
  technologies: string[];

  // Campos acrescentados na avaliação de presença digital. Snapshots antigos
  // não têm esses campos: a avaliação trata a ausência como "não medido".
  /** Tempo (ms) até o servidor entregar a página inicial. */
  loadMs?: number | null;
  /** Tamanho do HTML da página inicial, em bytes. */
  pageBytes?: number | null;
  hasStructuredData?: boolean;
  hasSocialPreview?: boolean;
  hasPrivacyLink?: boolean;
  /** A página sugere venda online (carrinho, comprar, checkout). */
  sellsOnline?: boolean;
  /** A página sugere agendamento/reserva online. */
  hasBooking?: boolean;
  /**
   * Sinais de código antigo na página inicial (doctype antigo, layout em
   * tabelas, tags obsoletas, Flash, jQuery 1.x/2.x). Vazio = nenhum sinal.
   */
  legacyCues?: string[];
  /** Imagens da página inicial. */
  images?: { total: number; withAlt: number; optimized: number };
}

const CTA_PATTERN =
  /(agende|agendar|agendamento|or[cç]amento|fale conosco|fale com|entre em contato|solicite|solicitar|reserv|comprar|whatsapp|chame)/i;

const ECOMMERCE_PATTERN =
  /(adicionar ao carrinho|add to cart|\bcarrinho\b|\bcheckout\b|finalizar compra|comprar agora|\bmeu carrinho\b)/i;

const BOOKING_PATTERN =
  /(agendar (consulta|hor[aá]rio|visita|atendimento)|agende (sua|seu|uma)|marque (sua|seu|uma)|reservar (mesa|hor[aá]rio)|agendamento online|calend[aá]rio de agendamento)/i;

const PHONE_PATTERN =
  /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;

/** Sinais objetivos de que o código da página é antigo. Não julga o visual. */
export function detectLegacyCues(html: string, $: cheerio.CheerioAPI): string[] {
  const cues: string[] = [];
  const doctype = html.slice(0, 1500).match(/<!doctype[^>]*>/i)?.[0];

  if (!doctype) {
    cues.push("sem declaração de documento moderna (doctype)");
  } else if (/xhtml|html 4|html 3|transitional|frameset/i.test(doctype)) {
    cues.push("doctype antigo (HTML 4/XHTML)");
  }

  const tableLayout =
    $("table[width], table[bgcolor], table[cellpadding], table[cellspacing]").length >= 2 ||
    $("table table table").length > 0;

  if (tableLayout) cues.push("layout montado com tabelas");

  if ($("font, center, marquee, blink, frameset, frame, big, strike").length > 0) {
    cues.push("tags obsoletas (font, center, marquee…)");
  }

  if (
    $('object[type*="shockwave"], embed[type*="shockwave"], embed[src$=".swf"], object[data$=".swf"]').length > 0 ||
    /\.swf(["'?\s])/i.test(html)
  ) {
    cues.push("usa Flash");
  }

  const jqueryMajors = [
    // jquery-1.12.4.min.js · jquery/2.2.4/jquery.min.js · jquery@1.9
    ...html.matchAll(/jquery[-.\/@]?(?:v)?(\d+)\.\d+/gi),
    // jquery.min.js?ver=1.12.4 (WordPress)
    ...html.matchAll(/jquery(?:\.min)?\.js\?ver=(\d+)\./gi),
  ].map((m) => Number(m[1]));
  const oldJquery = jqueryMajors.some((major) => major === 1 || major === 2);

  if (oldJquery) cues.push("jQuery antigo (versão 1.x/2.x)");

  return cues;
}

function imageStats($: cheerio.CheerioAPI) {
  const imgs = $("img").toArray();

  let withAlt = 0;
  let optimized = 0;

  for (const el of imgs) {
    const img = $(el);
    const src = `${img.attr("src") ?? ""} ${img.attr("data-src") ?? ""}`;

    if ((img.attr("alt") ?? "").trim()) withAlt += 1;

    if (
      img.attr("srcset") ||
      img.attr("loading") === "lazy" ||
      /\.(webp|avif)(\?|\s|$)/i.test(src) ||
      img.parent("picture").length > 0
    ) {
      optimized += 1;
    }
  }

  return { total: imgs.length, withAlt, optimized };
}

function detectTechnologies(
  html: string,
  generator: string | undefined,
): string[] {
  const tech = new Set<string>();

  if (generator) tech.add(generator.split(" ")[0]);

  const checks: [string, RegExp][] = [
    ["WordPress", /wp-content|wp-includes/i],
    ["Wix", /wixstatic\.com|wix\.com/i],
    ["Shopify", /cdn\.shopify\.com/i],
    ["Elementor", /elementor/i],
    ["Next.js", /__NEXT_DATA__/],
    ["Google Analytics", /googletagmanager\.com|google-analytics\.com|gtag\(/i],
    ["Meta Pixel", /connect\.facebook\.net|fbq\(/i],
  ];

  for (const [name, re] of checks) {
    if (re.test(html)) tech.add(name);
  }

  return [...tech];
}

/**
 * Extrai FATOS do HTML (sem executar JS, sem renderizar).
 * O HTML bruto nunca é guardado nem enviado à IA.
 */
export function extractWebsiteFacts(
  html: string,
  meta: {
    url: string;
    finalUrl?: string | null;
    httpStatus?: number | null;
  },
): WebsiteFacts {
  const $ = cheerio.load(html);

  const finalUrl = meta.finalUrl ?? meta.url;

  const headings = $("h1, h2")
    .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter(Boolean)
    .slice(0, 15);

  const whatsappLinks: string[] = [];
  const socialLinks: Record<string, string> = {};
  const phones = new Set<string>();
  const emails = new Set<string>();
  const ctas = new Set<string>();
  let contactPageUrl: string | null = null;

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();

    if (/wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(href)) {
      whatsappLinks.push(href);
    }

    if (href.startsWith("tel:")) {
      phones.add(href.slice(4).trim());
    }

    if (href.toLowerCase().startsWith("mailto:")) {
      const email = normalizeEmail(href);

      if (email) emails.add(email);
    }

    if (
      !contactPageUrl &&
      /(contato|contact|fale-?conosco|atendimento)/i.test(`${href} ${text}`) &&
      !/^(mailto:|tel:|javascript:|#)/i.test(href)
    ) {
      try {
        const resolved = new URL(href, finalUrl);

        if (resolved.hostname === new URL(finalUrl).hostname) {
          contactPageUrl = resolved.toString();
        }
      } catch {
        // href inválido
      }
    }

    const profile = socialProfile(href);

    if (profile && !socialLinks[profile.kind.toLowerCase()]) {
      socialLinks[profile.kind.toLowerCase()] = profile.url;
    }

    if (text && text.length <= 60 && CTA_PATTERN.test(text)) {
      ctas.add(text);
    }
  });

  $("button, input[type=submit]").each((_, el) => {
    const text = (
      $(el).text() || $(el).attr("value") || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    if (text && text.length <= 60 && CTA_PATTERN.test(text)) {
      ctas.add(text);
    }
  });

  const bodyText = $("body").text().replace(/\s+/g, " ");

  (bodyText.match(PHONE_PATTERN) ?? [])
    .slice(0, 5)
    .forEach((p) => phones.add(p.trim()));

  (bodyText.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => !!e)
    .slice(0, 10)
    .forEach((e) => emails.add(e));

  const copyright = bodyText.match(
    /(?:©|&copy;|copyright)\s*(?:\w+\s*)?(\d{4})/i,
  );

  return {
    url: meta.url,
    finalUrl,
    httpStatus: meta.httpStatus ?? null,
    https: finalUrl.startsWith("https://"),
    error: null,

    title: $("title").first().text().trim() || null,
    description:
      $('meta[name="description"]').attr("content")?.trim() ||
      null,
    headings,

    linkCount: $("a[href]").length,
    phones: [...phones].slice(0, 5),
    emails: [...emails].slice(0, 5),
    contactPageUrl,
    whatsappLinks: whatsappLinks.slice(0, 3),
    ctas: [...ctas].slice(0, 8),
    formsCount: $("form").length,
    socialLinks,
    copyrightYear: copyright ? Number(copyright[1]) : null,
    hasViewport: $('meta[name="viewport"]').length > 0,
    technologies: detectTechnologies(
      html,
      $('meta[name="generator"]').attr("content"),
    ),
    loadMs: null,
    pageBytes: html.length,
    hasStructuredData: $('script[type="application/ld+json"]').length > 0,
    hasSocialPreview: $('meta[property="og:title"], meta[property="og:image"]').length > 0,
    hasPrivacyLink:
      $("a[href]")
        .map((_, el) => `${$(el).attr("href") ?? ""} ${$(el).text()}`)
        .get()
        .some((t) => /(privacidade|privacy|lgpd|pol[ií]tica de dados)/i.test(t)),
    sellsOnline:
      ECOMMERCE_PATTERN.test(bodyText) ||
      /(woocommerce|cdn\.shopify\.com|nuvemshop|lojaintegrada|vtex)/i.test(html),
    hasBooking: BOOKING_PATTERN.test(bodyText),
    legacyCues: detectLegacyCues(html, $),
    images: imageStats($),
  };
}

export function failedWebsiteFacts(
  url: string,
  error: string,
  httpStatus: number | null = null,
): WebsiteFacts {
  return {
    url,
    finalUrl: null,
    httpStatus,
    https: url.startsWith("https://"),
    error,
    title: null,
    description: null,
    headings: [],
    linkCount: 0,
    phones: [],
    emails: [],
    contactPageUrl: null,
    whatsappLinks: [],
    ctas: [],
    formsCount: 0,
    socialLinks: {},
    copyrightYear: null,
    hasViewport: false,
    technologies: [],
    loadMs: null,
    pageBytes: null,
    hasStructuredData: false,
    hasSocialPreview: false,
    hasPrivacyLink: false,
    sellsOnline: false,
    hasBooking: false,
    legacyCues: [],
    images: { total: 0, withAlt: 0, optimized: 0 },
  };
}

/** Junta fatos da página de contato aos da página inicial. */
export function mergeWebsiteFacts(
  home: WebsiteFacts,
  extra: WebsiteFacts,
): WebsiteFacts {
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

  return {
    ...home,
    phones: union(home.phones, extra.phones).slice(0, 8),
    emails: union(home.emails, extra.emails).slice(0, 8),
    whatsappLinks: union(home.whatsappLinks, extra.whatsappLinks).slice(0, 5),
    ctas: union(home.ctas, extra.ctas).slice(0, 10),
    formsCount: Math.max(home.formsCount, extra.formsCount),
    socialLinks: { ...extra.socialLinks, ...home.socialLinks },
    hasPrivacyLink: !!(home.hasPrivacyLink || extra.hasPrivacyLink),
    sellsOnline: !!(home.sellsOnline || extra.sellsOnline),
    hasBooking: !!(home.hasBooking || extra.hasBooking),
  };
}
