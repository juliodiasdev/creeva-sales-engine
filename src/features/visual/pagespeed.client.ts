import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";
import { getSetting } from "../settings/settings.service";

import type { SiteMetrics } from "./visual.checklist";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 90_000;

export interface PagespeedResult {
  metrics: SiteMetrics;
  /** Captura da página no celular (data URL JPEG) para a IA olhar a aparência; null se o Google não devolver. */
  screenshot: string | null;
}

interface LighthouseResponse {
  lighthouseResult?: {
    runtimeError?: { message?: string };
    categories?: Record<string, { score?: number | null } | undefined>;
    audits?: Record<
      string,
      { numericValue?: number; details?: { data?: string } } | undefined
    >;
  };
  error?: { code?: number; message?: string; status?: string };
}

const pct = (score: number | null | undefined) =>
  typeof score === "number" && Number.isFinite(score)
    ? Math.round(score * 100)
    : null;

function describeFailure(status: number, body: LighthouseResponse): string {
  const detail = body.error?.message ?? "";

  if (status === 429) {
    return "O Google PageSpeed atingiu o limite de uso. Tente de novo em alguns minutos (ou configure a chave do Google em Settings).";
  }

  if (status === 403) {
    return "A chave do Google não tem a PageSpeed Insights API ativada. No Google Cloud, ative a 'PageSpeed Insights API' no mesmo projeto da chave (e inclua-a nas restrições da chave, se houver).";
  }

  if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE|NOT_HTML/i.test(detail)) {
    return "O Google não conseguiu abrir o site (fora do ar ou bloqueando visitas). Confira o endereço.";
  }

  return `Google PageSpeed (${status}): ${detail || "erro inesperado."}`;
}

async function call(url: string, key: string | null): Promise<Response> {
  const params = new URLSearchParams({ url, strategy: "mobile", locale: "pt_BR" });

  for (const category of ["performance", "accessibility", "best-practices", "seo"]) {
    params.append("category", category);
  }

  if (key) params.set("key", key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await httpFetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error("O Google PageSpeed demorou demais para responder. Tente novamente.");
    }

    throw new Error(
      `Não foi possível falar com o Google PageSpeed: ${err instanceof Error ? err.message : "falha de rede"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mede o site com o Google PageSpeed (Lighthouse, no celular): desempenho,
 * acessibilidade, boas práticas e SEO. É medição de terceiros, não opinião.
 */
export async function runPagespeed(rawUrl: string): Promise<PagespeedResult> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const key = (await getSetting("google_api_key")) || null;

  let response = await call(url, key);

  // Chave do Places geralmente é restrita a outras APIs: tenta uma vez sem chave.
  if (response.status === 403 && key) {
    response = await call(url, null);
  }

  await recordApiUsage({ provider: "WEBSITE", operation: "pagespeed" });

  let body: LighthouseResponse = {};

  try {
    body = (await response.json()) as LighthouseResponse;
  } catch {
    // corpo não-JSON
  }

  if (!response.ok) throw new Error(describeFailure(response.status, body));

  const lh = body.lighthouseResult;

  if (!lh || lh.runtimeError?.message) {
    throw new Error(
      lh?.runtimeError?.message
        ? `O Google não conseguiu medir o site: ${lh.runtimeError.message}`
        : "O Google não devolveu a medição do site.",
    );
  }

  const performance = pct(lh.categories?.performance?.score);

  if (performance === null) {
    throw new Error("O Google não conseguiu calcular a nota de desempenho deste site.");
  }

  const lcp = lh.audits?.["largest-contentful-paint"]?.numericValue;
  const shot = lh.audits?.["final-screenshot"]?.details?.data;

  return {
    metrics: {
      strategy: "mobile",
      performance,
      accessibility: pct(lh.categories?.accessibility?.score),
      bestPractices: pct(lh.categories?.["best-practices"]?.score),
      seo: pct(lh.categories?.seo?.score),
      lcpMs: typeof lcp === "number" && Number.isFinite(lcp) ? Math.round(lcp) : null,
      measuredAt: new Date().toISOString(),
    },
    screenshot:
      typeof shot === "string" && /^data:image\/(jpeg|png|webp);base64,/i.test(shot)
        ? shot
        : null,
  };
}
