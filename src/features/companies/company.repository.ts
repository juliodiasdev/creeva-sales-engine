import {
  getSupabase,
  nowIso,
  unwrap,
} from "../../lib/store";

import {
  buildDedupeKey,
  normalizeCnpj,
  normalizePhone,
  siteDomain,
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
  const row = unwrap(
    await getSupabase()
      .from("companies")
      .insert({
        name: input.name,
        segment: input.segment ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        website: input.website ?? null,
        phone: input.phone ?? null,
        instagram: input.instagram ?? null,
        google_place_id: input.googlePlaceId ?? null,
        cnpj: normalizeCnpj(input.cnpj),
        address: input.address ?? null,
        category: input.category ?? null,
        rating: input.rating ?? null,
        reviews_count: input.reviewsCount ?? null,
        domain: siteDomain(input.website),
        phone_normalized: normalizePhone(input.phone),
        dedupe_key: buildDedupeKey(
          input.name,
          input.address,
          input.city,
        ),
      })
      .select("id")
      .single(),
  ) as { id: number };

  return Number(row.id);
}

/**
 * Procura duplicata, em ordem de prioridade:
 * google_place_id, CNPJ, domínio, telefone, nome+endereço.
 */
export async function findDuplicateCompanyRepository(
  input: CreateCompanyInput,
): Promise<{ id: number; matchedBy: string } | null> {
  const checks: [string, string, unknown][] = [
    ["google_place_id", "google_place_id", input.googlePlaceId || null],
    ["cnpj", "cnpj", normalizeCnpj(input.cnpj)],
    ["domain", "domain", siteDomain(input.website)],
    ["phone", "phone_normalized", normalizePhone(input.phone)],
    [
      "name+address",
      "dedupe_key",
      buildDedupeKey(input.name, input.address, input.city),
    ],
  ];

  for (const [label, column, value] of checks) {
    if (!value) continue;

    const rows = unwrap(
      await getSupabase()
        .from("companies")
        .select("id")
        .eq(column, value)
        .limit(1),
    ) as { id: number }[];

    if (rows[0]) {
      return { id: Number(rows[0].id), matchedBy: label };
    }
  }

  return null;
}

export async function getCompanyRepository(
  id: number,
): Promise<Company | null> {
  return unwrap(
    await getSupabase()
      .from("companies")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  ) as Company | null;
}

export async function listCompaniesRepository(
  limit = 200,
  offset = 0,
): Promise<Company[]> {
  return unwrap(
    await getSupabase()
      .from("companies")
      .select("*")
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1),
  ) as Company[];
}

export async function countCompaniesRepository(): Promise<number> {
  const { count, error } = await getSupabase()
    .from("companies")
    .select("id", { count: "exact", head: true });

  if (error) throw new Error(error.message);

  return count ?? 0;
}

export async function addCompanySourceRepository(
  companyId: number,
  type: SourceType,
  sourceId?: string,
  raw?: unknown,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("company_sources")
      .insert({
        company_id: companyId,
        source_type: type,
        source_id: sourceId ?? null,
        raw_data: raw === undefined ? null : JSON.stringify(raw),
      }),
  );
}

export async function setLeadStatusRepository(
  companyId: number,
  status: LeadStatus,
  reason?: string,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("companies")
      .update({
        lead_status: status,
        disqualified_reason: reason ?? null,
        updated_at: nowIso(),
      })
      .eq("id", companyId),
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
  const current = await getCompanyRepository(companyId);

  if (!current) throw new Error("Empresa não encontrada.");

  // Dados do CNPJ vencem; endereço/site/telefone já cadastrados têm
  // precedência. Nunca apaga dado conhecido nem inventa dado ausente.
  const website = current.website ?? fields.website ?? null;
  const phone = current.phone ?? fields.phone ?? null;

  unwrap(
    await getSupabase()
      .from("companies")
      .update({
        cnpj: normalizeCnpj(fields.cnpj) ?? current.cnpj,
        legal_name: fields.legal_name ?? current.legal_name,
        cnae: fields.cnae ?? current.cnae,
        company_size: fields.company_size ?? current.company_size,
        registration_status:
          fields.registration_status ?? current.registration_status,
        opened_at: fields.opened_at ?? current.opened_at,
        capital: fields.capital ?? current.capital,
        address: current.address ?? fields.address ?? null,
        website,
        domain: current.domain ?? siteDomain(website),
        phone,
        phone_normalized:
          current.phone_normalized ?? normalizePhone(phone),
        updated_at: nowIso(),
      })
      .eq("id", companyId),
  );
}

export async function listCompanyIdsByLeadStatusRepository(
  status: LeadStatus,
  limit: number,
): Promise<number[]> {
  const rows = unwrap(
    await getSupabase()
      .from("companies")
      .select("id")
      .eq("lead_status", status)
      .order("id", { ascending: false })
      .limit(limit),
  ) as { id: number }[];

  return rows.map((r) => Number(r.id));
}

/** Busca rápida por nome (barra de busca global). */
export async function searchCompaniesRepository(
  term: string,
  limit = 8,
): Promise<Pick<Company, "id" | "name" | "city" | "segment" | "lead_status">[]> {
  const q = term.trim().replace(/[%_\\,()]/g, " ");

  if (q.length < 2) return [];

  return unwrap(
    await getSupabase()
      .from("companies")
      .select("id,name,city,segment,lead_status")
      .ilike("name", `%${q}%`)
      .order("name", { ascending: true })
      .limit(limit),
  ) as Pick<Company, "id" | "name" | "city" | "segment" | "lead_status">[];
}
