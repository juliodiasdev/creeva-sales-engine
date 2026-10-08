import { fetchByIds, getSupabase, unwrap } from "../../lib/store";

import type { Approach } from "./approaches.engine";

export interface StoredApproach {
  id: number;
  company_id: number;
  channel: Approach["channel"];
  service_key: string | null;
  angle: string;
  message: string;
  evidence_used: string | null;
  source: "TEMPLATE" | "AI";
  created_at: string;
}

/** Substitui as abordagens de uma origem (TEMPLATE ou AI) da empresa. */
export async function replaceApproachesRepository(
  companyId: number,
  source: "TEMPLATE" | "AI",
  approaches: Approach[],
): Promise<void> {
  const supabase = getSupabase();

  unwrap(
    await supabase
      .from("company_approaches")
      .delete()
      .eq("company_id", companyId)
      .eq("source", source),
  );

  if (approaches.length === 0) return;

  unwrap(
    await supabase.from("company_approaches").insert(
      approaches.map((a) => ({
        company_id: companyId,
        channel: a.channel,
        service_key: a.service_key,
        angle: a.angle,
        message: a.message,
        evidence_used: JSON.stringify(a.evidence_used),
        source,
      })),
    ),
  );
}

export async function listApproachesRepository(
  companyId: number,
): Promise<StoredApproach[]> {
  return unwrap(
    await getSupabase()
      .from("company_approaches")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: true }),
  ) as StoredApproach[];
}

export async function listApproachesForCompanies(
  companyIds: number[],
): Promise<StoredApproach[]> {
  return fetchByIds<StoredApproach>(
    "company_approaches",
    "*",
    "company_id",
    companyIds,
  );
}
