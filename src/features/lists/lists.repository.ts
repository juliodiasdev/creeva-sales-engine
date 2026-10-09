import {
  fetchAllPages,
  fetchByIds,
  getSupabase,
  nowIso,
  unwrap,
} from "../../lib/store";

import type { Company } from "../companies/company.types";

export interface ProspectList {
  id: number;
  name: string;
  segment: string | null;
  city: string | null;
  neighborhood: string | null;
  query_text: string | null;
  pages: number;
  status: "OPEN" | "ARCHIVED";
  found: number;
  imported: number;
  duplicates: number;
  already_seen: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function createListRepository(input: {
  name: string;
  segment: string;
  city: string;
  neighborhood?: string;
  queryText: string;
  pages: number;
}): Promise<number> {
  const row = unwrap(
    await getSupabase()
      .from("lists")
      .insert({
        name: input.name,
        segment: input.segment,
        city: input.city,
        neighborhood: input.neighborhood ?? null,
        query_text: input.queryText,
        pages: input.pages,
      })
      .select("id")
      .single(),
  ) as { id: number };

  return Number(row.id);
}

export async function updateListRepository(
  id: number,
  fields: Partial<
    Pick<
      ProspectList,
      | "name"
      | "status"
      | "notes"
      | "found"
      | "imported"
      | "duplicates"
      | "already_seen"
    >
  >,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("lists")
      .update({ ...fields, updated_at: nowIso() })
      .eq("id", id),
  );
}

export async function deleteListRepository(id: number): Promise<void> {
  unwrap(await getSupabase().from("lists").delete().eq("id", id));
}

export async function getListRepository(
  id: number,
): Promise<ProspectList | null> {
  return unwrap(
    await getSupabase()
      .from("lists")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  ) as ProspectList | null;
}

export async function listListsRepository(): Promise<ProspectList[]> {
  return fetchAllPages<ProspectList>((from, to) =>
    getSupabase()
      .from("lists")
      .select("*")
      .order("id", { ascending: false })
      .range(from, to) as never,
  );
}

export interface CompanyStage {
  id: number;
  list_id: number | null;
  lead_status: Company["lead_status"];
}

/** Só o necessário para contar as etapas de cada lista. */
export async function listCompanyStagesRepository(): Promise<CompanyStage[]> {
  return fetchAllPages<CompanyStage>((from, to) =>
    getSupabase()
      .from("companies")
      .select("id,list_id,lead_status")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );
}

export async function listCompaniesOfListRepository(
  listId: number,
): Promise<Company[]> {
  return fetchAllPages<Company>((from, to) =>
    getSupabase()
      .from("companies")
      .select("*")
      .eq("list_id", listId)
      .order("id", { ascending: true })
      .range(from, to) as never,
  );
}

export async function listCompaniesByIdsRepository(
  ids: number[],
): Promise<Company[]> {
  return fetchByIds<Company>("companies", "*", "id", ids);
}

export async function setCompaniesLeadStatusRepository(
  ids: number[],
  status: Company["lead_status"],
  reason?: string,
): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    unwrap(
      await getSupabase()
        .from("companies")
        .update({
          lead_status: status,
          disqualified_reason: reason ?? null,
          updated_at: nowIso(),
        })
        .in("id", ids.slice(i, i + 100)),
    );
  }
}

export async function assignCompaniesToListRepository(
  ids: number[],
  listId: number,
): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    unwrap(
      await getSupabase()
        .from("companies")
        .update({ list_id: listId })
        .in("id", ids.slice(i, i + 100)),
    );
  }
}
