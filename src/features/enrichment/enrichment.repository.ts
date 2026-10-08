import { getSupabase, nowIso, unwrap } from "../../lib/store";

import type { Signal } from "../signals/signals.engine";
import type { ScoreResult } from "../scoring/scoring.engine";
import type { WebsiteFacts } from "./website.facts";

export interface StoredSignal extends Signal {
  id: number;
  company_id: number;
  created_at: string;
}

export interface StoredScore {
  id: number;
  company_id: number;
  fit: number;
  need: number;
  capacity: number;
  intent: number;
  total: number;
  confidence: number;
  reasons: string;
  created_at: string;
}

export async function saveSnapshotRepository(
  companyId: number,
  facts: WebsiteFacts,
): Promise<void> {
  unwrap(
    await getSupabase().from("website_snapshots").insert({
      company_id: companyId,
      url: facts.url,
      facts: JSON.stringify(facts),
    }),
  );
}

export async function getLatestSnapshotRepository(
  companyId: number,
): Promise<WebsiteFacts | null> {
  const rows = unwrap(
    await getSupabase()
      .from("website_snapshots")
      .select("facts")
      .eq("company_id", companyId)
      .order("id", { ascending: false })
      .limit(1),
  ) as { facts: string }[];

  return rows[0] ? (JSON.parse(rows[0].facts) as WebsiteFacts) : null;
}

/** Substitui os signals da empresa pelos recém-derivados. */
export async function replaceSignalsRepository(
  companyId: number,
  signals: Signal[],
): Promise<void> {
  const supabase = getSupabase();

  unwrap(
    await supabase.from("signals").delete().eq("company_id", companyId),
  );

  if (signals.length === 0) return;

  unwrap(
    await supabase.from("signals").insert(
      signals.map((s) => ({
        company_id: companyId,
        type: s.type,
        value: s.value,
        evidence: s.evidence,
        source: s.source,
        confidence: s.confidence,
      })),
    ),
  );
}

export async function listSignalsRepository(
  companyId: number,
): Promise<StoredSignal[]> {
  return unwrap(
    await getSupabase()
      .from("signals")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: true }),
  ) as StoredSignal[];
}

export async function saveScoreRepository(
  companyId: number,
  score: ScoreResult,
): Promise<void> {
  const supabase = getSupabase();

  unwrap(
    await supabase.from("company_scores").insert({
      company_id: companyId,
      fit: score.fit,
      need: score.need,
      capacity: score.capacity,
      intent: score.intent,
      total: score.total,
      confidence: score.confidence,
      reasons: JSON.stringify(score.reasons),
    }),
  );

  // Mantém o prospect (se existir) com o score mais recente.
  const values: Record<string, unknown> = {
    score: score.total,
    updated_at: nowIso(),
  };

  if (score.total >= 75) values.priority = "HIGH";

  unwrap(
    await supabase
      .from("prospects")
      .update(values)
      .eq("company_id", companyId),
  );
}

export async function getLatestScoreRepository(
  companyId: number,
): Promise<StoredScore | null> {
  const rows = unwrap(
    await getSupabase()
      .from("company_scores")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: false })
      .limit(1),
  ) as StoredScore[];

  return rows[0] ?? null;
}
