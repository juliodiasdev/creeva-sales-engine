import * as cheerio from "cheerio";

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
  whatsappLinks: string[];
  ctas: string[];
  formsCount: number;
  socialLinks: Record<string, string>;
  copyrightYear: number | null;
  hasViewport: boolean;
  technologies: string[];
}

const CTA_PATTERN =
  /(agende|agendar|agendamento|or[cç]amento|fale conosco|fale com|entre em contato|solicite|solicitar|reserv|comprar|whatsapp|chame)/i;

const SOCIAL_HOSTS: Record<string, RegExp> = {
  instagram: /instagram\.com/i,
  facebook: /facebook\.com/i,
  linkedin: /linkedin\.com/i,
  youtube: /youtube\.com/i,
  tiktok: /tiktok\.com/i,
};

const PHONE_PATTERN =
  /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;

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
  const ctas = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();

    if (/wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(href)) {
      whatsappLinks.push(href);
    }

    if (href.startsWith("tel:")) {
      phones.add(href.slice(4).trim());
    }

    for (const [name, re] of Object.entries(SOCIAL_HOSTS)) {
      if (re.test(href) && !socialLinks[name]) {
        socialLinks[name] = href;
      }
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
    whatsappLinks: [],
    ctas: [],
    formsCount: 0,
    socialLinks: {},
    copyrightYear: null,
    hasViewport: false,
    technologies: [],
  };
}
