import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";

import {
  extractWebsiteFacts,
  failedWebsiteFacts,
} from "./website.facts";

import type { WebsiteFacts } from "./website.facts";

const MAX_HTML_BYTES = 1_500_000;
const TIMEOUT_MS = 15_000;

function withProtocol(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * Busca a página inicial e extrai fatos. HTML externo é tratado
 * apenas como texto/DOM de leitura: nada é renderizado nem executado.
 */
export async function crawlWebsite(
  rawUrl: string,
): Promise<WebsiteFacts> {
  const url = withProtocol(rawUrl.trim());

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
      return {
        ...failedWebsiteFacts(
          url,
          `HTTP ${response.status}`,
          response.status,
        ),
        finalUrl,
      };
    }

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);

    return extractWebsiteFacts(html, {
      url,
      finalUrl,
      httpStatus: response.status,
    });
  } catch (err) {
    return failedWebsiteFacts(
      url,
      err instanceof Error ? err.message : "Falha de rede",
    );
  } finally {
    clearTimeout(timer);
  }
}
