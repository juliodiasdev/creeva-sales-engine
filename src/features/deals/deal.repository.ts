import {
  getDatabase,
} from "../../lib/database";

import type {
  Deal,
  Meeting,
  Proposal,
} from "./deal.types";

export async function getOpenDealRepository(
  prospectId: number,
): Promise<Deal | null> {
  const db = await getDatabase();

  const rows = await db.select<Deal[]>(
    `
      SELECT * FROM deals
      WHERE prospect_id = $1 AND status = 'OPEN'
      ORDER BY id DESC
      LIMIT 1
    `,
    [prospectId],
  );

  return rows[0] ?? null;
}

export async function listDealsRepository(
  prospectId?: number,
): Promise<Deal[]> {
  const db = await getDatabase();

  return db.select<Deal[]>(
    `
      SELECT * FROM deals
      WHERE $1 IS NULL OR prospect_id = $1
      ORDER BY id DESC
    `,
    [prospectId ?? null],
  );
}

export async function createDealRepository(
  input: {
    prospectId: number;
    title: string;
    serviceType?: string;
    value: number;
    expectedCloseInDays?: number;
  },
): Promise<number> {
  const db = await getDatabase();

  const result = await db.execute(
    `
      INSERT INTO deals (
        prospect_id, title, service_type, value, expected_close_at
      )
      VALUES (
        $1, $2, $3, $4,
        CASE
          WHEN $5 IS NULL THEN NULL
          ELSE datetime('now', '+' || $5 || ' days')
        END
      )
    `,
    [
      input.prospectId,
      input.title,
      input.serviceType ?? null,
      input.value,
      input.expectedCloseInDays ?? null,
    ],
  );

  return Number(result.lastInsertId);
}

export async function updateOpenDealValueRepository(
  dealId: number,
  value: number,
  serviceType?: string,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      UPDATE deals
      SET value = $2,
          service_type = COALESCE($3, service_type),
          updated_at = datetime('now')
      WHERE id = $1
    `,
    [dealId, value, serviceType ?? null],
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
  const db = await getDatabase();

  await db.execute(
    `
      UPDATE deals
      SET status = $2,
          closed_at = datetime('now'),
          probability = CASE WHEN $2 = 'WON' THEN 100 ELSE 0 END,
          value = COALESCE($3, value),
          service_type = COALESCE($4, service_type),
          recurring = $5,
          lost_reason = $6,
          updated_at = datetime('now')
      WHERE id = $1
    `,
    [
      dealId,
      status,
      extra.value ?? null,
      extra.serviceType ?? null,
      extra.recurring ? 1 : 0,
      extra.lostReason ?? null,
    ],
  );
}

export async function createMeetingRepository(
  input: {
    prospectId: number;
    scheduledAt: string;
    notes?: string;
    need?: string;
    budget?: string;
    decisionMaker?: string;
    timeline?: string;
  },
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO meetings (
        prospect_id, scheduled_at, notes, need,
        budget, decision_maker, timeline
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.prospectId,
      input.scheduledAt,
      input.notes ?? null,
      input.need ?? null,
      input.budget ?? null,
      input.decisionMaker ?? null,
      input.timeline ?? null,
    ],
  );
}

export async function listMeetingsRepository(
  prospectId: number,
): Promise<Meeting[]> {
  const db = await getDatabase();

  return db.select<Meeting[]>(
    `SELECT * FROM meetings WHERE prospect_id = $1 ORDER BY scheduled_at DESC`,
    [prospectId],
  );
}

export async function createProposalRepository(
  input: {
    dealId: number;
    prospectId: number;
    value: number;
    description?: string;
    validDays?: number;
  },
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO proposals (
        deal_id, prospect_id, value, description, valid_until
      )
      VALUES (
        $1, $2, $3, $4,
        CASE
          WHEN $5 IS NULL THEN NULL
          ELSE datetime('now', '+' || $5 || ' days')
        END
      )
    `,
    [
      input.dealId,
      input.prospectId,
      input.value,
      input.description ?? null,
      input.validDays ?? null,
    ],
  );
}

export async function listProposalsRepository(
  prospectId: number,
): Promise<Proposal[]> {
  const db = await getDatabase();

  return db.select<Proposal[]>(
    `SELECT * FROM proposals WHERE prospect_id = $1 ORDER BY id DESC`,
    [prospectId],
  );
}
