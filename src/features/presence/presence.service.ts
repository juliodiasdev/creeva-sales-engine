import { fetchByIds, getSupabase, nowIso, unwrap } from "../../lib/store";

import { getCompanyRepository } from "../companies/company.repository";
import { listChannelsRepository } from "../contacts/channels.repository";
import { consolidateChannels } from "../contacts/consolidate";
import { getLatestSnapshotRepository } from "../enrichment/enrichment.repository";

import { assessPresence, PRESENCE_VERSION } from "./presence.engine";
import type { PresenceLevel, PresenceReport, SaleMoment } from "./presence.engine";

export interface StoredPresence {
  companyId: number;
  score: number | null;
  level: PresenceLevel;
  confidence: number;
  moment: SaleMoment;
  report: PresenceReport;
  computedAt: string;
}

interface Row {
  company_id: number;
  score: number | null;
  level: PresenceLevel;
  confidence: number;
  moment: SaleMoment;
  report: string;
  computed_at: string;
}

const fromRow = (r: Row): StoredPresence | null => {
  try {
    return {
      companyId: Number(r.company_id),
      score: r.score === null ? null : Number(r.score),
      level: r.level,
      confidence: Number(r.confidence),
      moment: r.moment,
      report: JSON.parse(r.report) as PresenceReport,
      computedAt: r.computed_at,
    };
  } catch {
    return null;
  }
};

/**
 * Avalia a presença digital com o que já foi coletado (cadastro do Google,
 * canais e a última leitura do site) e guarda o resultado. Pode ser refeita a
 * qualquer momento, sem nova leitura do site.
 */
export async function assessAndSavePresence(
  companyId: number,
  now = new Date(),
): Promise<PresenceReport> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const [channels, facts] = await Promise.all([
    listChannelsRepository(companyId),
    getLatestSnapshotRepository(companyId),
  ]);

  const report = assessPresence({
    company,
    channels: consolidateChannels(channels).main,
    facts,
    now,
  });

  unwrap(
    await getSupabase()
      .from("presence_reports")
      .upsert(
        {
          company_id: companyId,
          score: report.score,
          level: report.level,
          confidence: report.confidence,
          moment: report.moment,
          report: JSON.stringify(report),
          computed_at: nowIso(),
        },
        { onConflict: "company_id" },
      ),
  );

  return report;
}

export async function getPresence(companyId: number): Promise<StoredPresence | null> {
  const row = unwrap(
    await getSupabase()
      .from("presence_reports")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle(),
  ) as Row | null;

  return row ? fromRow(row) : null;
}

/** Resumo (sem o relatório completo) de várias empresas, para tabelas. */
export async function listPresenceSummaries(
  companyIds: number[],
): Promise<Map<number, Pick<StoredPresence, "score" | "level" | "moment" | "confidence">>> {
  const rows = await fetchByIds<Omit<Row, "report">>(
    "presence_reports",
    "company_id,score,level,confidence,moment,computed_at",
    "company_id",
    companyIds,
  );

  return new Map(
    rows.map((r) => [
      Number(r.company_id),
      {
        score: r.score === null ? null : Number(r.score),
        level: r.level,
        moment: r.moment,
        confidence: Number(r.confidence),
      },
    ]),
  );
}

export { PRESENCE_VERSION };
