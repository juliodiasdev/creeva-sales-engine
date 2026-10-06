import {
  getCompanyRepository,
  setLeadStatusRepository,
} from "../companies/company.repository";

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

import { crawlWebsite } from "./website.crawler";
import type { WebsiteFacts } from "./website.facts";

export interface EnrichmentOutcome {
  total: number;
  status: string;
}

type Crawler = (url: string) => Promise<WebsiteFacts>;

/**
 * DISCOVERED -> ENRICHING -> (score >= mínimo) QUALIFIED.
 * Empresa com CNPJ não ativo é DISQUALIFIED com motivo registrado.
 * Score abaixo do mínimo permanece ENRICHING (decisão humana).
 */
export async function enrichCompany(
  companyId: number,
  crawler: Crawler = crawlWebsite,
): Promise<EnrichmentOutcome> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  if (company.lead_status === "READY") {
    // Já virou prospect: apenas reavalia dados, sem mudar o estágio.
  } else {
    await setLeadStatusRepository(companyId, "ENRICHING");
  }

  let facts: WebsiteFacts | null = null;

  if (company.website) {
    facts = await crawler(company.website);
    await saveSnapshotRepository(companyId, facts);
  } else {
    facts = await getLatestSnapshotRepository(companyId);
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

  if (company.lead_status === "READY") {
    return { total: score.total, status: "READY" };
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

  return { total: score.total, status };
}

export function startEnrichmentJob(companyIds: number[]) {
  return startJob("ENRICHMENT", async (report) => {
    const outcomes: Record<number, EnrichmentOutcome | string> = {};

    for (const [i, id] of companyIds.entries()) {
      try {
        outcomes[id] = await enrichCompany(id);
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
