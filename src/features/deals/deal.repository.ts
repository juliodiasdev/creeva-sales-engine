import {
  getSupabase,
  inDaysIso,
  nowIso,
  unwrap,
} from "../../lib/store";

import type {
  Deal,
  Meeting,
  Proposal,
} from "./deal.types";

export async function getOpenDealRepository(
  prospectId: number,
): Promise<Deal | null> {
  const rows = unwrap(
    await getSupabase()
      .from("deals")
      .select("*")
      .eq("prospect_id", prospectId)
      .eq("status", "OPEN")
      .order("id", { ascending: false })
      .limit(1),
  ) as Deal[];

  return rows[0] ?? null;
}

export async function listDealsRepository(
  prospectId?: number,
): Promise<Deal[]> {
  let query = getSupabase()
    .from("deals")
    .select("*")
    .order("id", { ascending: false });

  if (prospectId !== undefined) {
    query = query.eq("prospect_id", prospectId);
  }

  return unwrap(await query) as Deal[];
}

export async function createDealRepository(input: {
  prospectId: number;
  title: string;
  serviceType?: string;
  value: number;
  expectedCloseInDays?: number;
}): Promise<number> {
  const row = unwrap(
    await getSupabase()
      .from("deals")
      .insert({
        prospect_id: input.prospectId,
        title: input.title,
        service_type: input.serviceType ?? null,
        value: input.value,
        expected_close_at:
          input.expectedCloseInDays === undefined
            ? null
            : inDaysIso(input.expectedCloseInDays),
      })
      .select("id")
      .single(),
  ) as { id: number };

  return Number(row.id);
}

export async function updateOpenDealValueRepository(
  dealId: number,
  value: number,
  serviceType?: string,
): Promise<void> {
  const values: Record<string, unknown> = {
    value,
    updated_at: nowIso(),
  };

  if (serviceType) values.service_type = serviceType;

  unwrap(
    await getSupabase().from("deals").update(values).eq("id", dealId),
  );
}

export async function closeDealRepository(
  dealId: number,
  status: "WON" | "LOST",
  extra: {
    value?: number;
    serviceType?: string;
    recurring?: boolean;
    lostReason?: string;
  } = {},
): Promise<void> {
  const values: Record<string, unknown> = {
    status,
    closed_at: nowIso(),
    probability: status === "WON" ? 100 : 0,
    recurring: extra.recurring ? 1 : 0,
    lost_reason: extra.lostReason ?? null,
    updated_at: nowIso(),
  };

  if (extra.value !== undefined) values.value = extra.value;
  if (extra.serviceType) values.service_type = extra.serviceType;

  unwrap(
    await getSupabase().from("deals").update(values).eq("id", dealId),
  );
}

export async function createMeetingRepository(input: {
  prospectId: number;
  scheduledAt: string;
  notes?: string;
  need?: string;
  budget?: string;
  decisionMaker?: string;
  timeline?: string;
}): Promise<void> {
  const when = new Date(input.scheduledAt.replace(" ", "T"));

  unwrap(
    await getSupabase()
      .from("meetings")
      .insert({
        prospect_id: input.prospectId,
        scheduled_at: Number.isNaN(when.getTime())
          ? input.scheduledAt
          : when.toISOString(),
        notes: input.notes ?? null,
        need: input.need ?? null,
        budget: input.budget ?? null,
        decision_maker: input.decisionMaker ?? null,
        timeline: input.timeline ?? null,
      }),
  );
}

export async function listMeetingsRepository(
  prospectId: number,
): Promise<Meeting[]> {
  return unwrap(
    await getSupabase()
      .from("meetings")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("scheduled_at", { ascending: false }),
  ) as Meeting[];
}

export async function createProposalRepository(input: {
  dealId: number;
  prospectId: number;
  value: number;
  description?: string;
  validDays?: number;
}): Promise<void> {
  unwrap(
    await getSupabase()
      .from("proposals")
      .insert({
        deal_id: input.dealId,
        prospect_id: input.prospectId,
        value: input.value,
        description: input.description ?? null,
        valid_until:
          input.validDays === undefined
            ? null
            : inDaysIso(input.validDays),
      }),
  );
}

export async function listProposalsRepository(
  prospectId: number,
): Promise<Proposal[]> {
  return unwrap(
    await getSupabase()
      .from("proposals")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("id", { ascending: false }),
  ) as Proposal[];
}
