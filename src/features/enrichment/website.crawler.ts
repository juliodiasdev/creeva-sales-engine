import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";

import {
  extractWebsiteFacts,
  failedWebsiteFacts,
  mergeWebsiteFacts,
} from "./website.facts";

import type { WebsiteFacts } from "./website.facts";

const MAX_HTML_BYTES = 1_500_000;
const TIMEOUT_MS = 15_000;

function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

async function fetchHtml(
  url: string,
): Promise<{ html: string; finalUrl: string; status: number } | { error: string; status: number | null; finalUrl: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await httpFetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "CreavaSalesEngine/0.1" },
    });

    await recordApiUsage({
      provider: "WEBSITE",
      operation: "fetch",
    });

    const finalUrl = response.url || url;

    if (!response.ok) {
      return { error: `HTTP ${response.status}`, status: response.status, finalUrl };
    }

    return {
      html: (await response.text()).slice(0, MAX_HTML_BYTES),
      finalUrl,
      status: response.status,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Falha de rede",
      status: null,
      finalUrl: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busca a página inicial (e a página de contato, se houver) e extrai
 * fatos. HTML externo é tratado só como texto/DOM de leitura: nada é
 * renderizado nem executado.
 */
export async function crawlWebsite(
  rawUrl: string,
): Promise<WebsiteFacts> {
  const url = withProtocol(rawUrl.trim());

  const home = await fetchHtml(url);

  if ("error" in home) {
    return {
      ...failedWebsiteFacts(url, home.error, home.status),
      finalUrl: home.finalUrl,
    };
  }

  const facts = extractWebsiteFacts(home.html, {
    url,
    finalUrl: home.finalUrl,
    httpStatus: home.status,
  });

  if (facts.contactPageUrl && facts.contactPageUrl !== home.finalUrl) {
    const contact = await fetchHtml(facts.contactPageUrl);

    if (!("error" in contact)) {
      return mergeWebsiteFacts(
        facts,
        extractWebsiteFacts(contact.html, {
          url: facts.contactPageUrl,
          finalUrl: contact.finalUrl,
          httpStatus: contact.status,
        }),
      );
    }
  }

  return facts;
}
