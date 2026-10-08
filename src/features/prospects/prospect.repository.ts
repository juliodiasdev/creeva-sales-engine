import {
  fetchAllPages,
  fetchByIds,
  getSupabase,
  inDaysIso,
  nowIso,
  unwrap,
} from "../../lib/store";

import type {
  Prospect,
  ProspectStatus,
  ProspectWithCompany,
} from "./prospect.types";

type CompanyInfo = {
  id: number;
  name: string;
  segment: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  instagram: string | null;
};

const COMPANY_COLUMNS =
  "id,name,segment,city,state,website,phone,instagram";

function attachCompany(
  prospect: Prospect,
  company: CompanyInfo | undefined,
): ProspectWithCompany {
  return {
    ...prospect,
    company_name: company?.name ?? "—",
    segment: company?.segment ?? null,
    city: company?.city ?? null,
    state: company?.state ?? null,
    website: company?.website ?? null,
    phone: company?.phone ?? null,
    instagram: company?.instagram ?? null,
  };
}

export async function createProspectRepository(
  companyId: number,
): Promise<number> {
  const supabase = getSupabase();

  const scores = unwrap(
    await supabase
      .from("company_scores")
      .select("total")
      .eq("company_id", companyId)
      .order("id", { ascending: false })
      .limit(1),
  ) as { total: number }[];

  const row = unwrap(
    await supabase
      .from("prospects")
      .insert({
        company_id: companyId,
        status: "READY",
        priority: "NORMAL",
        score: scores[0]?.total ?? 0,
        next_action: "Realizar primeiro contato",
      })
      .select("id")
      .single(),
  ) as { id: number };

  return Number(row.id);
}

export async function listProspectsRepository(): Promise<
  ProspectWithCompany[]
> {
  const prospects = await fetchAllPages<Prospect>((from, to) =>
    getSupabase()
      .from("prospects")
      .select("*")
      .order("id", { ascending: false })
      .range(from, to) as never,
  );

  const companies = await fetchByIds<CompanyInfo>(
    "companies",
    COMPANY_COLUMNS,
    "id",
    prospects.map((p) => Number(p.company_id)),
  );

  const byId = new Map(companies.map((c) => [Number(c.id), c]));

  return prospects.map((p) =>
    attachCompany(p, byId.get(Number(p.company_id))),
  );
}

export async function prospectExistsForCompanyRepository(
  companyId: number,
): Promise<boolean> {
  const { count, error } = await getSupabase()
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (error) throw new Error(error.message);

  return (count ?? 0) > 0;
}

export async function getProspectContextRepository(
  prospectId: number,
): Promise<ProspectWithCompany | null> {
  const prospect = unwrap(
    await getSupabase()
      .from("prospects")
      .select("*")
      .eq("id", prospectId)
      .maybeSingle(),
  ) as Prospect | null;

  if (!prospect) return null;

  const company = unwrap(
    await getSupabase()
      .from("companies")
      .select(COMPANY_COLUMNS)
      .eq("id", prospect.company_id)
      .maybeSingle(),
  ) as CompanyInfo | null;

  return attachCompany(prospect, company ?? undefined);
}

export async function updateProspectWorkflowRepository(
  prospectId: number,
  input: {
    status?: ProspectStatus;
    nextAction: string | null;
    nextActionInDays?: number;
    lostReason?: string | null;
    /** true: grava closed_at agora; false: limpa (reabertura). */
    closed?: boolean;
  },
): Promise<void> {
  const values: Record<string, unknown> = {
    next_action: input.nextAction,
    next_action_at:
      input.nextActionInDays === undefined
        ? null
        : inDaysIso(input.nextActionInDays),
    updated_at: nowIso(),
  };

  if (input.status) values.status = input.status;

  if (input.closed === true) {
    values.closed_at = nowIso();
    values.lost_reason = input.lostReason ?? null;
  } else if (input.closed === false) {
    values.closed_at = null;
    values.lost_reason = null;
  }

  unwrap(
    await getSupabase()
      .from("prospects")
      .update(values)
      .eq("id", prospectId),
  );
}
