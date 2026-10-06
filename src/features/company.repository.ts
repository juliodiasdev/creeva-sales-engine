import { getDatabase } from "../../lib/database";

import type {
  Company,
  CreateCompanyInput,
} from "./company.types";

export async function createCompanyRepository(
  input: CreateCompanyInput,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO companies (
        name,
        segment,
        city,
        state,
        website,
        phone,
        instagram,
        google_place_id
      )

      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
    `,
    [
      input.name,
      input.segment ?? null,
      input.city ?? null,
      input.state ?? null,
      input.website ?? null,
      input.phone ?? null,
      input.instagram ?? null,
      input.googlePlaceId ?? null,
    ],
  );
}

export async function listCompaniesRepository(): Promise<Company[]> {
  const db = await getDatabase();

  return db.select<Company[]>(`
    SELECT *
    FROM companies
    ORDER BY id DESC
  `);
}