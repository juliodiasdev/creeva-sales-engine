import {
  getDatabase,
} from "../../lib/database";

import type {
  ProspectStatus,
  ProspectWithCompany,
} from "./prospect.types";

export async function createProspectRepository(
  companyId: number,
): Promise<number> {
  const db = await getDatabase();

  const result = await db.execute(
    `
      INSERT INTO prospects (
        company_id,
        status,
        priority,
        score,
        next_action
      )
      VALUES (
        $1,
        'READY',
        'NORMAL',
        0,
        'Realizar primeiro contato'
      )
    `,
    [companyId],
  );

  return Number(result.lastInsertId);
}

export async function listProspectsRepository():
Promise<ProspectWithCompany[]> {
  const db = await getDatabase();

  return db.select<ProspectWithCompany[]>(`
    SELECT
      p.*,

      c.name AS company_name,
      c.segment,
      c.city,
      c.state,
      c.website,
      c.phone,
      c.instagram

    FROM prospects p

    INNER JOIN companies c
      ON c.id = p.company_id

    ORDER BY p.id DESC
  `);
}

export async function prospectExistsForCompanyRepository(
  companyId: number,
): Promise<boolean> {
  const db = await getDatabase();

  const rows = await db.select<
    { count: number }[]
  >(
    `
      SELECT COUNT(*) AS count

      FROM prospects

      WHERE company_id = $1
    `,
    [companyId],
  );

  return rows[0]?.count > 0;
}

export async function getProspectContextRepository(
  prospectId: number,
): Promise<ProspectWithCompany | null> {
  const db = await getDatabase();

  const rows = await db.select<
    ProspectWithCompany[]
  >(
    `
      SELECT
        p.*,

        c.name AS company_name,
        c.segment,
        c.city,
        c.state,
        c.website,
        c.phone,
        c.instagram

      FROM prospects p

      INNER JOIN companies c
        ON c.id = p.company_id

      WHERE p.id = $1
    `,
    [prospectId],
  );

  return rows[0] ?? null;
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
  const db = await getDatabase();

  await db.execute(
    `
      UPDATE prospects
      SET
        status = COALESCE($2, status),
        next_action = $3,
        next_action_at = CASE
          WHEN $4 IS NULL THEN NULL
          ELSE datetime('now', '+' || $4 || ' days')
        END,
        lost_reason = CASE
          WHEN $6 = 1 THEN $5
          WHEN $6 = 0 THEN NULL
          ELSE lost_reason
        END,
        closed_at = CASE
          WHEN $6 = 1 THEN datetime('now')
          WHEN $6 = 0 THEN NULL
          ELSE closed_at
        END,
        updated_at = datetime('now')
      WHERE id = $1
    `,
    [
      prospectId,
      input.status ?? null,
      input.nextAction,
      input.nextActionInDays ?? null,
      input.lostReason ?? null,
      input.closed === undefined
        ? null
        : input.closed
          ? 1
          : 0,
    ],
  );
}