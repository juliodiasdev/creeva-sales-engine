import {
  getSupabase,
  nowIso,
  unwrap,
} from "../../lib/store";

import { normalizeText } from "../../lib/normalize";

export interface SearchRecord {
  id: number;
  query_key: string;
  segment: string;
  city: string;
  neighborhood: string | null;
  pages: number;
  runs: number;
  last_found: number;
  last_imported: number;
  last_run_at: string;
}

const BATCH = 100;

/** Lugares já coletados (registro permanente OU empresa existente). */
export async function findKnownPlaceIds(
  placeIds: string[],
): Promise<Set<string>> {
  const known = new Set<string>();
  const supabase = getSupabase();

  for (let i = 0; i < placeIds.length; i += BATCH) {
    const batch = placeIds.slice(i, i + BATCH);

    const seen = unwrap(
      await supabase
        .from("seen_places")
        .select("google_place_id")
        .in("google_place_id", batch),
    ) as { google_place_id: string }[];

    const companies = unwrap(
      await supabase
        .from("companies")
        .select("google_place_id")
        .in("google_place_id", batch),
    ) as { google_place_id: string }[];

    for (const row of [...seen, ...companies]) {
      known.add(row.google_place_id);
    }
  }

  return known;
}

/** Marca o lugar como coletado para sempre (nunca importar nem cobrar de novo). */
export async function markPlaceSeen(
  placeId: string,
  companyId: number | null,
): Promise<void> {
  const supabase = getSupabase();

  const existing = unwrap(
    await supabase
      .from("seen_places")
      .select("times_seen,company_id")
      .eq("google_place_id", placeId)
      .maybeSingle(),
  ) as { times_seen: number; company_id: number | null } | null;

  if (existing) {
    unwrap(
      await supabase
        .from("seen_places")
        .update({
          times_seen: Number(existing.times_seen) + 1,
          last_seen_at: nowIso(),
          company_id: companyId ?? existing.company_id,
        })
        .eq("google_place_id", placeId),
    );
    return;
  }

  unwrap(
    await supabase.from("seen_places").insert({
      google_place_id: placeId,
      company_id: companyId,
    }),
  );
}

export function searchKey(
  segment: string,
  city: string,
  neighborhood?: string,
): string {
  return [segment, city, neighborhood ?? ""]
    .map((v) => normalizeText(v))
    .join("|");
}

export async function getSearchRecord(
  segment: string,
  city: string,
  neighborhood?: string,
): Promise<SearchRecord | null> {
  return unwrap(
    await getSupabase()
      .from("discovery_searches")
      .select("*")
      .eq("query_key", searchKey(segment, city, neighborhood))
      .maybeSingle(),
  ) as SearchRecord | null;
}

export async function recordSearch(input: {
  segment: string;
  city: string;
  neighborhood?: string;
  pages: number;
  found: number;
  imported: number;
}): Promise<void> {
  const supabase = getSupabase();
  const existing = await getSearchRecord(
    input.segment,
    input.city,
    input.neighborhood,
  );

  if (existing) {
    unwrap(
      await supabase
        .from("discovery_searches")
        .update({
          runs: Number(existing.runs) + 1,
          pages: input.pages,
          last_found: input.found,
          last_imported: input.imported,
          last_run_at: nowIso(),
        })
        .eq("id", existing.id),
    );
    return;
  }

  unwrap(
    await supabase.from("discovery_searches").insert({
      query_key: searchKey(input.segment, input.city, input.neighborhood),
      segment: input.segment,
      city: input.city,
      neighborhood: input.neighborhood ?? null,
      pages: input.pages,
      last_found: input.found,
      last_imported: input.imported,
    }),
  );
}

export async function listSearches(limit = 10): Promise<SearchRecord[]> {
  return unwrap(
    await getSupabase()
      .from("discovery_searches")
      .select("*")
      .order("last_run_at", { ascending: false })
      .limit(limit),
  ) as SearchRecord[];
}
