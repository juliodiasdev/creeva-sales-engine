import { getDatabase } from "../../lib/database";

import {
  buildDedupeKey,
  normalizeCnpj,
  normalizeDomain,
  normalizePhone,
} from "../../lib/normalize";

import type {
  Company,
  CreateCompanyInput,
  LeadStatus,
  SourceType,
} from "./company.types";

export async function createCompanyRepository(
  input: CreateCompanyInput,
): Promise<number> {
  const db = await getDatabase();

  const result = await db.execute(
    `
      INSERT INTO companies (
        name, segment, city, state, website, phone, instagram,
        google_place_id, cnpj, address, category, rating,
        reviews_count, domain, phone_normalized, dedupe_key
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
      normalizeCnpj(input.cnpj),
      input.address ?? null,
      input.category ?? null,
      input.rating ?? null,
      input.reviewsCount ?? null,
      normalizeDomain(input.website),
      normalizePhone(input.phone),
      buildDedupeKey(input.name, input.address, input.city),
    ],
  );

  return Number(result.lastInsertId);
}

/**
 * Procura duplicata, em ordem de prioridade:
 * google_place_id, CNPJ, domínio, telefone, nome+endereço.
 */
export async function findDuplicateCompanyRepository(
  input: CreateCompanyInput,
): Promise<{ id: number; matchedBy: string } | null> {
  const db = await getDatabase();

  const checks: [string, string, unknown][] = [
    [
      "google_place_id",
      "google_place_id",
      input.googlePlaceId || null,
    ],
    ["cnpj", "cnpj", normalizeCnpj(input.cnpj)],
    ["domain", "domain", normalizeDomain(input.website)],
    [
      "phone",
      "phone_normalized",
      normalizePhone(input.phone),
    ],
    [
      "name+address",
      "dedupe_key",
      buildDedupeKey(input.name, input.address, input.city),
    ],
  ];

  for (const [label, column, value] of checks) {
    if (!value) continue;

    const rows = await db.select<{ id: number }[]>(
      `SELECT id FROM companies WHERE ${column} = $1 LIMIT 1`,
      [value],
    );

    if (rows[0]) {
      return { id: rows[0].id, matchedBy: label };
    }
  }

  return null;
}

export async function getCompanyRepository(
  id: number,
): Promise<Company | null> {
  const db = await getDatabase();

  const rows = await db.select<Company[]>(
    `SELECT * FROM companies WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
}

export async function listCompaniesRepository(
  limit = 200,
  offset = 0,
): Promise<Company[]> {
  const db = await getDatabase();

  return db.select<Company[]>(
    `
      SELECT *
      FROM companies
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
}

export async function countCompaniesRepository(): Promise<number> {
  const db = await getDatabase();

  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM companies`,
  );

  return rows[0]?.n ?? 0;
}

export async function addCompanySourceRepository(
  companyId: number,
  type: SourceType,
  sourceId?: string,
  raw?: unknown,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO company_sources (company_id, source_type, source_id, raw_data)
      VALUES ($1, $2, $3, $4)
    `,
    [
      companyId,
      type,
      sourceId ?? null,
      raw === undefined ? null : JSON.stringify(raw),
    ],
  );
}

export async function setLeadStatusRepository(
  companyId: number,
  status: LeadStatus,
  reason?: string,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      UPDATE companies
      SET lead_status = $2,
          disqualified_reason = $3,
          updated_at = datetime('now')
      WHERE id = $1
    `,
    [companyId, status, reason ?? null],
  );
}

export async function updateCompanyEnrichmentRepository(
  companyId: number,
  fields: Partial<
    Pick<
      Company,
      | "cnpj"
      | "legal_name"
      | "cnae"
      | "company_size"
      | "registration_status"
      | "opened_at"
      | "capital"
      | "address"
      | "website"
      | "phone"
    >
  >,
): Promise<void> {
  const db = await getDatabase();

  // COALESCE: nunca apaga dado já conhecido nem inventa dado ausente;
  // endereço/site/telefone já cadastrados têm precedência.
  await db.execute(
    `
      UPDATE companies SET
        cnpj = COALESCE($2, cnpj),
        legal_name = COALESCE($3, legal_name),
        cnae = COALESCE($4, cnae),
        company_size = COALESCE($5, company_size),
        registration_status = COALESCE($6, registration_status),
        opened_at = COALESCE($7, opened_at),
        capital = COALESCE($8, capital),
        address = COALESCE(address, $9),
        website = COALESCE(website, $10),
        domain = COALESCE(domain, $11),
        phone = COALESCE(phone, $12),
        phone_normalized = COALESCE(phone_normalized, $13),
        updated_at = datetime('now')
      WHERE id = $1
    `,
    [
      companyId,
      normalizeCnpj(fields.cnpj),
      fields.legal_name ?? null,
      fields.cnae ?? null,
      fields.company_size ?? null,
      fields.registration_status ?? null,
      fields.opened_at ?? null,
      fields.capital ?? null,
      fields.address ?? null,
      fields.website ?? null,
      normalizeDomain(fields.website),
      fields.phone ?? null,
      normalizePhone(fields.phone),
    ],
  );
}


export async function listCompanyIdsByLeadStatusRepository(
  status: LeadStatus,
  limit: number,
): Promise<number[]> {
  const db = await getDatabase();

  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM companies WHERE lead_status = $1 ORDER BY id DESC LIMIT $2`,
    [status, limit],
  );

  return rows.map((r) => r.id);
}
