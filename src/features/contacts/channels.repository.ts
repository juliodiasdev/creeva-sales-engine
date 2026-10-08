import {
  fetchAllPages,
  fetchByIds,
  getSupabase,
  unwrap,
} from "../../lib/store";

import type { ChannelInput, ChannelKind } from "./channels.engine";

export interface StoredChannel {
  id: number;
  company_id: number;
  kind: ChannelKind;
  value: string;
  url: string | null;
  label: string | null;
  source: string;
}

/** Insere canais novos; os que já existem (mesmo tipo e valor) são mantidos. */
export async function saveChannelsRepository(
  companyId: number,
  channels: ChannelInput[],
): Promise<void> {
  if (channels.length === 0) return;

  unwrap(
    await getSupabase()
      .from("company_channels")
      .upsert(
        channels.map((c) => ({
          company_id: companyId,
          kind: c.kind,
          value: c.value,
          url: c.url,
          label: c.label,
          source: c.source,
        })),
        {
          onConflict: "company_id,kind,value",
          ignoreDuplicates: true,
        },
      ),
  );
}

export async function listChannelsRepository(
  companyId: number,
): Promise<StoredChannel[]> {
  return unwrap(
    await getSupabase()
      .from("company_channels")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: true }),
  ) as StoredChannel[];
}

export async function listChannelsForCompanies(
  companyIds: number[],
): Promise<StoredChannel[]> {
  return fetchByIds<StoredChannel>(
    "company_channels",
    "*",
    "company_id",
    companyIds,
  );
}

export async function listAllChannelsRepository(): Promise<StoredChannel[]> {
  return fetchAllPages<StoredChannel>((from, to) =>
    getSupabase()
      .from("company_channels")
      .select("*")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );
}
