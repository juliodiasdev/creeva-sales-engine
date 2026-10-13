import { getSupabase, nowIso, unwrap } from "../../lib/store";

import type {
  SiteMetrics,
  VisualAnswer,
  VisualReview,
  VisualSource,
  VisualTarget,
} from "./visual.checklist";

interface Row {
  company_id: number;
  target: VisualTarget;
  answers: string;
  metrics: string | null;
  summary: string | null;
  source: VisualSource;
  reviewed_at: string;
}

function parse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const fromRow = (r: Row): VisualReview => ({
  target: r.target,
  answers: parse<VisualAnswer[]>(r.answers, []),
  metrics: parse<SiteMetrics | null>(r.metrics, null),
  summary: r.summary,
  source: r.source,
  reviewedAt: r.reviewed_at,
});

export async function listVisualReviewsRepository(
  companyId: number,
): Promise<VisualReview[]> {
  const rows = unwrap(
    await getSupabase()
      .from("visual_reviews")
      .select("*")
      .eq("company_id", companyId),
  ) as Row[];

  return rows.map(fromRow);
}

export async function upsertVisualReviewRepository(
  companyId: number,
  review: Omit<VisualReview, "reviewedAt">,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("visual_reviews")
      .upsert(
        {
          company_id: companyId,
          target: review.target,
          answers: JSON.stringify(review.answers),
          metrics: review.metrics ? JSON.stringify(review.metrics) : null,
          summary: review.summary,
          source: review.source,
          reviewed_at: nowIso(),
        },
        { onConflict: "company_id,target" },
      ),
  );
}
