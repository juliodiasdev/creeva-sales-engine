import {
  getCompanyRepository,
  listCompanyIdsByLeadStatusRepository,
  setLeadStatusRepository,
} from "../companies/company.repository";

import { isGenericHost } from "../../lib/normalize";
import { startJob } from "../jobs/job.service";
import { getSetting } from "../settings/settings.service";

import { deriveSignals } from "../signals/signals.engine";
import { computeScore } from "../scoring/scoring.engine";

import {
  getLatestSnapshotRepository,
  replaceSignalsRepository,
  saveScoreRepository,
  saveSnapshotRepository,
} from "./enrichment.repository";

import { buildChannels } from "../contacts/channels.engine";
import {
  listChannelsRepository,
  saveChannelsRepository,
} from "../contacts/channels.repository";
import { buildTemplateApproaches } from "../contacts/approaches.engine";
import { replaceApproachesRepository } from "../contacts/approaches.repository";
import { matchServices } from "../services/offers.engine";
import { listServices } from "../services/services.service";
import type { ServiceKey } from "../services/services.service";

import { planCompanyWithAi } from "../ai/ai.service";
import { crawlWebsite } from "./website.crawler";
import type { WebsiteFacts } from "./website.facts";

export interface EnrichmentOutcome {
  total: number | null;
  status: string;
  channels: number;
}

/** Cada etapa é opcional: o usuário escolhe o que quer executar. */
export interface EnrichOptions {
  /** Ler o site (início + contato): e-mails, redes, WhatsApp. */
  crawlSite: boolean;
  /** Gerar sinais, score, serviços sugeridos e abordagens (sem IA). */
  analyze: boolean;
  /** Plano com IA (OpenAI): 1 chamada por empresa. Opcional e pago. */
  ai?: boolean;
}

export const DEFAULT_ENRICH_OPTIONS: EnrichOptions = {
  crawlSite: true,
  analyze: true,
};

type Crawler = (url: string) => Promise<WebsiteFacts>;

/**
 * DISCOVERED -> ENRICHING -> (score >= mínimo) QUALIFIED.
 * Empresa com CNPJ não ativo é DISQUALIFIED com motivo registrado.
 * Score abaixo do mínimo permanece ENRICHING (decisão humana).
 *
 * Tudo aqui é determinístico (sem IA).
 */
export async function enrichCompany(
  companyId: number,
  crawler: Crawler = crawlWebsite,
  options: EnrichOptions = DEFAULT_ENRICH_OPTIONS,
): Promise<EnrichmentOutcome> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  if (company.lead_status !== "READY") {
    await setLeadStatusRepository(companyId, "ENRICHING");
  }

  let facts: WebsiteFacts | null = null;

  if (
    company.website &&
    !isGenericHost(company.website) &&
    options.crawlSite
  ) {
    facts = await crawler(company.website);
    await saveSnapshotRepository(companyId, facts);
  } else {
    facts = await getLatestSnapshotRepository(companyId);
  }

  // Canais de contato reais (Google + site), sem duplicar.
  const channels = buildChannels(company, facts);
  await saveChannelsRepository(companyId, channels);

  if (!options.analyze) {
    return {
      total: null,
      status: company.lead_status === "READY" ? "READY" : "ENRICHING",
      channels: channels.length,
    };
  }

  const signals = deriveSignals(company, facts);
  await replaceSignalsRepository(companyId, signals);

  const preferred = (
    (await getSetting("preferred_segments")) ?? ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const score = computeScore({
    company,
    signals,
    facts,
    preferredSegments: preferred,
  });

  await saveScoreRepository(companyId, score);

  // Serviços da Creava mais adequados + abordagens por canal (templates).
  const services = await listServices(true);

  const matches = matchServices({
    company,
    signals,
    facts,
    activeKeys: services.map((s) => s.key as ServiceKey),
  });

  await replaceApproachesRepository(
    companyId,
    "TEMPLATE",
    buildTemplateApproaches({
      companyName: company.name,
      segment: company.segment,
      matches,
      availableChannels: [
        ...new Set([
          ...channels.map((c) => c.kind),
          ...(await listChannelsRepository(companyId)).map((c) => c.kind),
        ]),
      ],
      agency: (await getSetting("company_name")) ?? "Creava Digital",
      seller: (await getSetting("seller_name")) ?? "",
    }),
  );

  if (company.lead_status === "READY") {
    return { total: score.total, status: "READY", channels: channels.length };
  }

  const status = company.registration_status &&
    !company.registration_status.toUpperCase().includes("ATIVA")
    ? "DISQUALIFIED"
    : score.total >= Number((await getSetting("min_score")) ?? 50)
      ? "QUALIFIED"
      : "ENRICHING";

  await setLeadStatusRepository(
    companyId,
    status,
    status === "DISQUALIFIED"
      ? `CNPJ com situação ${company.registration_status}`
      : undefined,
  );

  return { total: score.total, status, channels: channels.length };
}

export function startEnrichmentJob(
  companyIds: number[],
  options: EnrichOptions = DEFAULT_ENRICH_OPTIONS,
) {
  return startJob("ENRICHMENT", async (report) => {
    const outcomes: Record<number, EnrichmentOutcome | string> = {};

    for (const [i, id] of companyIds.entries()) {
      try {
        outcomes[id] = await enrichCompany(id, crawlWebsite, options);

        if (options.ai) {
          // Falha da IA não desfaz o enriquecimento determinístico.
          try {
            await planCompanyWithAi(id);
          } catch (err) {
            outcomes[id] = `${err instanceof Error ? err.message : "erro"} (IA)`;
          }
        }
      } catch (err) {
        outcomes[id] = err instanceof Error ? err.message : "erro";
      }

      await report(((i + 1) / companyIds.length) * 100);
    }

    return outcomes;
  });
}

export async function disqualifyCompany(
  companyId: number,
  reason: string,
): Promise<void> {
  if (!reason.trim()) {
    throw new Error("Informe o motivo da desqualificação.");
  }

  await setLeadStatusRepository(
    companyId,
    "DISQUALIFIED",
    reason.trim(),
  );
}

/** Enriquece até `limit` empresas ainda em DISCOVERED. */
export async function startEnrichmentForDiscovered(
  limit = 50,
): Promise<number> {
  const ids = await listCompanyIdsByLeadStatusRepository(
    "DISCOVERED",
    limit,
  );

  if (ids.length === 0) {
    throw new Error(
      "Nenhuma empresa descoberta aguardando enriquecimento.",
    );
  }

  return startEnrichmentJob(ids);
}
