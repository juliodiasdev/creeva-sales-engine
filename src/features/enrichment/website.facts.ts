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
  /**
   * Ferramentas de automação que o CÓDIGO da página carrega (chat, agenda, pagamento, CRM,
   * loja, pedidos). Só vale o que foi encontrado: ausência não prova que a empresa não usa.
   */
  tools?: DetectedTool[];
  /** A página usa Google Tag Manager, que pode carregar ferramentas invisíveis a esta leitura. */
  hasTagManager?: boolean;
}

export type ToolCategory = "CHAT" | "BOOKING" | "PAYMENT" | "CRM" | "ECOMMERCE" | "DELIVERY";

export interface DetectedTool {
  category: ToolCategory;
  name: string;
}

const CTA_PATTERN =
  /(agende|agendar|agendamento|or[cç]amento|fale conosco|fale com|entre em contato|solicite|solicitar|reserv|comprar|whatsapp|chame)/i;

const ECOMMERCE_PATTERN =
  /(adicionar ao carrinho|add to cart|\bcarrinho\b|\bcheckout\b|finalizar compra|comprar agora|\bmeu carrinho\b)/i;

const BOOKING_PATTERN =
  /(agendar (consulta|hor[aá]rio|visita|atendimento)|agende (sua|seu|uma)|marque (sua|seu|uma)|reservar (mesa|hor[aá]rio)|agendamento online|calend[aá]rio de agendamento)/i;

const PHONE_PATTERN =
  /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;

/** Nome inteiro da ferramenta: não casa no meio de outra palavra ("local.com" não é "cal.com"). */
const edge = (host: string) => new RegExp(`(?:^|[^a-z0-9-])(?:${host})(?:[^a-z0-9]|$)`);

/**
 * Ferramentas reconhecidas pelo NOME/endereço próprio delas em scripts, iframes, links e
 * formulários. Texto visível da página nunca conta (ex.: "aceitamos PayPal" não é a ferramenta).
 */
const TOOL_PATTERNS: [ToolCategory, string, RegExp][] = [
  ["CHAT", "Tawk.to", edge("tawk\\.to")],
  ["CHAT", "JivoChat", edge("jivosite\\.com|jivochat\\.[a-z.]+")],
  ["CHAT", "Tidio", edge("tidio\\.co|tidiochat\\.com")],
  ["CHAT", "Crisp", edge("crisp\\.chat")],
  ["CHAT", "Intercom", edge("intercom\\.io|intercomcdn\\.com")],
  ["CHAT", "Zendesk", edge("zdassets\\.com|zopim\\.com|zendesk\\.com")],
  ["CHAT", "Drift", edge("drift\\.com|driftt\\.com")],
  ["CHAT", "Octadesk", edge("octadesk\\.[a-z.]+")],
  ["CHAT", "Chatwoot", edge("chatwoot\\.[a-z.]+")],
  ["CHAT", "Landbot", edge("landbot\\.io")],
  ["CHAT", "ManyChat", edge("manychat\\.com")],
  ["BOOKING", "Calendly", edge("calendly\\.com")],
  ["BOOKING", "Cal.com", edge("cal\\.com")],
  ["BOOKING", "Simples Agenda", edge("simplesagenda\\.[a-z.]+")],
  ["BOOKING", "Trinks", edge("trinks\\.com")],
  ["BOOKING", "Doctoralia", edge("doctoralia\\.[a-z.]+")],
  ["BOOKING", "Booksy", edge("booksy\\.com")],
  ["BOOKING", "Setmore", edge("setmore\\.com")],
  ["BOOKING", "Acuity Scheduling", edge("acuityscheduling\\.com")],
  ["BOOKING", "Reservio", edge("reservio\\.com")],
  ["PAYMENT", "Mercado Pago", edge("mercadopago\\.[a-z.]+|mpago\\.la")],
  ["PAYMENT", "PagBank/PagSeguro", edge("pagseguro\\.[a-z.]+|pagbank\\.[a-z.]+|pag\\.ae")],
  ["PAYMENT", "Stripe", edge("stripe\\.com")],
  ["PAYMENT", "Pagar.me", edge("pagar\\.me")],
  ["PAYMENT", "Asaas", edge("asaas\\.com")],
  ["PAYMENT", "PayPal", edge("paypal\\.com|paypal\\.me")],
  ["PAYMENT", "Hotmart", edge("hotmart\\.com")],
  ["PAYMENT", "Eduzz", edge("eduzz\\.com")],
  ["PAYMENT", "Kiwify", edge("kiwify\\.com(?:\\.br)?")],
  ["CRM", "RD Station", edge("rdstation\\.[a-z.]+|rdstation")],
  ["CRM", "HubSpot", edge("hubspot\\.com|hs-scripts\\.com|hsforms\\.(?:net|com)|hs-analytics\\.net")],
  ["CRM", "ActiveCampaign", edge("activecampaign\\.com|trackcmp\\.net")],
  ["CRM", "Mailchimp", edge("mailchimp\\.com|list-manage\\.com|chimpstatic\\.com")],
  ["CRM", "Pipedrive", edge("pipedrive\\.com")],
  ["CRM", "Kommo/amoCRM", edge("kommo\\.com|amocrm\\.[a-z.]+")],
  ["CRM", "Zoho", edge("zohopublic\\.[a-z.]+|zohocrm\\.[a-z.]+|zohoforms\\.[a-z.]+|zohocampaigns\\.[a-z.]+")],
  ["CRM", "LeadLovers", edge("leadlovers\\.com")],
  ["CRM", "Mautic", edge("mautic\\.[a-z.]+")],
  ["CRM", "Klaviyo", edge("klaviyo\\.com")],
  ["CRM", "Brevo (Sendinblue)", edge("sendinblue\\.com|brevo\\.com")],
  ["ECOMMERCE", "Shopify", edge("cdn\\.shopify\\.com|myshopify\\.com")],
  ["ECOMMERCE", "WooCommerce", edge("woocommerce")],
  ["ECOMMERCE", "Nuvemshop", edge("nuvemshop\\.[a-z.]+|lojanuvem\\.[a-z.]+|mitiendanube\\.com|tiendanube\\.com")],
  ["ECOMMERCE", "Loja Integrada", edge("lojaintegrada\\.com\\.br")],
  ["ECOMMERCE", "VTEX", edge("vtex[a-z]*\\.[a-z.]+")],
  ["ECOMMERCE", "Yampi", edge("yampi\\.[a-z.]+")],
  ["ECOMMERCE", "Bagy", edge("bagy\\.com\\.br")],
  ["DELIVERY", "iFood", edge("ifood\\.com\\.br")],
  ["DELIVERY", "Anota AI", edge("anota\\.ai")],
  ["DELIVERY", "Goomer", edge("goomer\\.[a-z.]+")],
  ["DELIVERY", "Menu Dino", edge("menudino\\.[a-z.]+")],
  ["DELIVERY", "Cardápio Web", edge("cardapioweb\\.[a-z.]+")],
];

/** Endereços carregados pela página (scripts, iframes, links, formulários) + código dos scripts. */
export function detectTools($: cheerio.CheerioAPI): DetectedTool[] {
  const refs: string[] = [];

  $("script[src], iframe[src], link[href], a[href], form[action]").each((_, el) => {
    const node = $(el);

    refs.push(
      node.attr("src") ?? "",
      node.attr("href") ?? "",
      node.attr("action") ?? "",
    );
  });

  const inline = $("script:not([src])")
    .map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n")
    .slice(0, 400_000);

  const haystack = `${refs.join("\n")}\n${inline}`.toLowerCase();
  const found = new Map<string, DetectedTool>();

  for (const [category, name, re] of TOOL_PATTERNS) {
    if (re.test(haystack)) found.set(`${category}:${name}`, { category, name });
  }

  return [...found.values()];
}

/** Sinais FORTES de código antigo; os demais são fracos e sozinhos não bastam. */
const STRONG_CUES = new Set([
  "sem declaração de documento moderna (doctype)",
  "doctype antigo (HTML 4/XHTML)",
  "usa Flash",
  "jQuery antigo (versão 1.x/2.x)",
  "tags obsoletas de movimento ou quadros (marquee, blink, frameset)",
]);

/**
 * NONE = nenhum sinal · MINOR = um sinal ou só sinais fracos · STRONG = um sinal forte
 * junto de outro, ou dois fortes. Só STRONG vira problema; MINOR é atenção.
 */
export function legacyLevel(cues: string[]): "NONE" | "MINOR" | "STRONG" {
  if (cues.length === 0) return "NONE";

  const strong = cues.filter((c) => STRONG_CUES.has(c)).length;

  return strong >= 2 || (strong >= 1 && cues.length >= 2) ? "STRONG" : "MINOR";
}

/** Sinais objetivos de que o código da página é antigo. Não julga o visual. */
export function detectLegacyCues(html: string, $: cheerio.CheerioAPI): string[] {
  const cues: string[] = [];
  const doctype = html.slice(0, 1500).match(/<!doctype[^>]*>/i)?.[0];

  if (!doctype) {
    cues.push("sem declaração de documento moderna (doctype)");
  } else if (/xhtml|html 4|html 3|transitional|frameset/i.test(doctype)) {
    cues.push("doctype antigo (HTML 4/XHTML)");
  }

  // Tabela de dados simples não é layout: precisa de tabela dentro de tabela com atributos de layout.
  const tableLayout =
    ($("table table").length > 0 && $("table[width], table[bgcolor], table[cellpadding], table[cellspacing]").length > 0) ||
    $("table table table").length > 0;

  if (tableLayout) cues.push("layout montado com tabelas");

  if ($("marquee, blink, frameset, frame").length > 0) {
    cues.push("tags obsoletas de movimento ou quadros (marquee, blink, frameset)");
  }

  if ($("font, center, big, strike").length > 0) {
    cues.push("tags de formatação obsoletas (font, center…)");
  }

  // Só atributos de verdade (src/data/value): ".swf" em texto ou em script não conta.
  if (
    $('object[type*="shockwave"], embed[type*="shockwave"], embed[src*=".swf"], object[data*=".swf"], param[value*=".swf"]').length > 0
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
  // Imagem decorativa (alt vazio explícito, role=presentation, aria-hidden) não entra na conta.
  const imgs = $("img")
    .toArray()
    .filter((el) => {
      const img = $(el);

      return !(
        img.attr("alt") === "" ||
        /^(presentation|none)$/i.test(img.attr("role") ?? "") ||
        img.attr("aria-hidden") === "true"
      );
    });

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
    tools: detectTools($),
    hasTagManager: /googletagmanager\.com\/(?:gtm\.js|ns\.html)/i.test(html),
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
    tools: [],
    hasTagManager: false,
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
    tools: [
      ...new Map(
        [...(home.tools ?? []), ...(extra.tools ?? [])].map((t) => [`${t.category}:${t.name}`, t]),
      ).values(),
    ],
    hasTagManager: !!(home.hasTagManager || extra.hasTagManager),
  };
}
