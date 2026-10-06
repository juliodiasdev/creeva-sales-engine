import {
  getDatabase,
} from "../../lib/database";

import type {
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
      c.state

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