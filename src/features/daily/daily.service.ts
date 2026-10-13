import { fetchAllPages, fetchByIds, getSupabase } from "../../lib/store";

import { planCompanyWithAi } from "../ai/ai.service";
import { suppressedCompanyIds } from "../compliance/suppression.service";
import { startJob } from "../jobs/job.service";
import { createProspect } from "../prospects/prospect.service";
import { getSetting, setSetting } from "../settings/settings.service";

/** Diagnóstico mais velho que isso é refeito (o site pode ter mudado). */
export const DIAGNOSIS_MAX_AGE_DAYS = 14;

export const DEFAULT_DAY_SIZE = 20;
export const MAX_DAY_SIZE = 25;

export interface DayCandidate {
  companyId: number;
  name: string;
  segment: string | null;
  city: string | null;
  score: number | null;
  /** Já existe diagnóstico recente (não precisa chamar a IA de novo). */
  hasFreshDiagnosis: boolean;
}

/** Empresas (entre `ids`) com diagnóstico de IA recente. */
export async function freshDiagnosisIds(
  ids: number[],
  now = new Date(),
): Promise<Set<number>> {
  const analyses = await fetchByIds<{ company_id: number; created_at: string }>(
    "ai_analyses",
    "company_id,created_at",
    "company_id",
    ids,
  );

  const cutoff = now.getTime() - DIAGNOSIS_MAX_AGE_DAYS * 86_400_000;

  return new Set(
    analyses
      .filter((a) => new Date(a.created_at).getTime() >= cutoff)
      .map((a) => Number(a.company_id)),
  );
}

/**
 * Quem entra no dia: empresas QUALIFICADAS por você (decisão humana) que
 * ainda não estão em abordagem e não pediram para parar, das melhores
 * pontuações para baixo.
 */
export async function planDay(
  limit = DEFAULT_DAY_SIZE,
  now = new Date(),
): Promise<DayCandidate[]> {
  const supabase = getSupabase();

  const companies = await fetchAllPages<{
    id: number;
    name: string;
    segment: string | null;
    city: string | null;
  }>((from, to) =>
    supabase
      .from("companies")
      .select("id,name,segment,city")
      .eq("lead_status", "QUALIFIED")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  if (companies.length === 0) return [];

  const ids = companies.map((c) => Number(c.id));

  const [blocked, scores, fresh] = await Promise.all([
    suppressedCompanyIds(ids),
    fetchByIds<{ id: number; company_id: number; total: number }>(
      "company_scores",
      "id,company_id,total",
      "company_id",
      ids,
    ),
    freshDiagnosisIds(ids, now),
  ]);

  const latestScore = new Map<number, { id: number; total: number }>();

  for (const s of scores) {
    const cur = latestScore.get(Number(s.company_id));

    if (!cur || Number(s.id) > cur.id) {
      latestScore.set(Number(s.company_id), { id: Number(s.id), total: Number(s.total) });
    }
  }

  return companies
    .filter((c) => !blocked.has(Number(c.id)))
    .map(
      (c): DayCandidate => ({
        companyId: Number(c.id),
        name: c.name,
        segment: c.segment,
        city: c.city,
        score: latestScore.get(Number(c.id))?.total ?? null,
        hasFreshDiagnosis: fresh.has(Number(c.id)),
      }),
    )
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) || a.companyId - b.companyId,
    )
    .slice(0, Math.min(Math.max(limit, 1), MAX_DAY_SIZE));
}

export interface DayRunResult {
  /** Empresas que viraram prospect com a 1ª ligação agendada. */
  prospected: number;
  /** Diagnósticos novos gerados pela IA nesta rodada. */
  diagnosed: number;
  /** Chamadas de IA que falharam (a empresa segue sem diagnóstico). */
  aiFailed: number;
  failed: number;
  errors: string[];
}

export async function getLastDayRun(): Promise<string | null> {
  return getSetting("daily_last_run");
}

/**
 * Monta o dia: gera o diagnóstico de gargalos (se faltar e se você aceitar
 * usar a IA) e inicia a abordagem das empresas escolhidas. Roda como job.
 */
export function startDay(
  companyIds: number[],
  options: { useAi: boolean },
): Promise<number> {
  const ids = [...new Set(companyIds)].slice(0, MAX_DAY_SIZE);

  if (ids.length === 0) throw new Error("Escolha ao menos uma empresa.");

  return startJob("DAILY", async (report) => {
    const fresh = await freshDiagnosisIds(ids);

    const result: DayRunResult = {
      prospected: 0,
      diagnosed: 0,
      aiFailed: 0,
      failed: 0,
      errors: [],
    };

    for (const [i, id] of ids.entries()) {
      if (options.useAi && !fresh.has(id)) {
        try {
          await planCompanyWithAi(id);
          result.diagnosed++;
        } catch (err) {
          result.aiFailed++;
          result.errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      try {
        await createProspect(id);
        result.prospected++;
      } catch (err) {
        result.failed++;
        result.errors.push(err instanceof Error ? err.message : String(err));
      }

      await report(((i + 1) / ids.length) * 100);
    }

    await setSetting("daily_last_run", new Date().toISOString().slice(0, 10));

    result.errors = [...new Set(result.errors)].slice(0, 5);

    return result;
  });
}
