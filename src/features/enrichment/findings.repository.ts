import { fetchAllPages, fetchByIds, getSupabase, nowIso, unwrap } from "../../lib/store";

import type { Finding, FindingField } from "./findings.validation";

export type FindingStatus = "SUGGESTED" | "ACCEPTED" | "REJECTED";

export interface StoredFinding {
  id: number;
  company_id: number;
  field: FindingField;
  value: string;
  source_url: string;
  evidence: string | null;
  verified: number;
  status: FindingStatus;
  model: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Guarda as sugestões; o que já existe (aceito ou rejeitado) não é recriado. */
export async function saveFindingsRepository(
  companyId: number,
  findings: (Finding & { verified: boolean })[],
  model: string | null,
): Promise<void> {
  if (findings.length === 0) return;

  unwrap(
    await getSupabase()
      .from("enrichment_findings")
      .upsert(
        findings.map((f) => ({
          company_id: companyId,
          field: f.field,
          value: f.value,
          source_url: f.sourceUrl,
          evidence: f.evidence,
          verified: f.verified ? 1 : 0,
          model,
        })),
        { onConflict: "company_id,field,value", ignoreDuplicates: true },
      ),
  );
}

export async function listFindingsRepository(
  companyId: number,
): Promise<StoredFinding[]> {
  return unwrap(
    await getSupabase()
      .from("enrichment_findings")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: true }),
  ) as StoredFinding[];
}

export async function listFindingsForCompanies(
  companyIds: number[],
): Promise<StoredFinding[]> {
  return fetchByIds<StoredFinding>(
    "enrichment_findings",
    "*",
    "company_id",
    companyIds,
  );
}

export async function getFindingRepository(
  id: number,
): Promise<StoredFinding | null> {
  return unwrap(
    await getSupabase()
      .from("enrichment_findings")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  ) as StoredFinding | null;
}

/** Decide uma sugestão só se ainda estiver pendente (sem decidir duas vezes). */
export async function decideFindingRepository(
  id: number,
  status: "ACCEPTED" | "REJECTED",
): Promise<boolean> {
  const rows = unwrap(
    await getSupabase()
      .from("enrichment_findings")
      .update({ status, decided_at: nowIso() })
      .eq("id", id)
      .eq("status", "SUGGESTED")
      .select("id"),
  ) as { id: number }[];

  return rows.length > 0;
}

/** Devolve a sugestão para pendente (usado quando a aplicação falha). */
export async function reopenFindingRepository(id: number): Promise<void> {
  unwrap(
    await getSupabase()
      .from("enrichment_findings")
      .update({ status: "SUGGESTED", decided_at: null })
      .eq("id", id),
  );
}

export async function countPendingFindings(): Promise<number> {
  const rows = await fetchAllPages<{ id: number }>((from, to) =>
    getSupabase()
      .from("enrichment_findings")
      .select("id")
      .eq("status", "SUGGESTED")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  return rows.length;
}
