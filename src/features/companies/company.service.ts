import {
  addCompanySourceRepository,
  countCompaniesRepository,
  createCompanyRepository,
  findDuplicateCompanyRepository,
  listCompaniesRepository,
} from "./company.repository";

import type {
  CreateCompanyInput,
  SourceType,
} from "./company.types";

function clean(input: CreateCompanyInput): CreateCompanyInput {
  const name = input.name.trim();

  if (!name) {
    throw new Error("O nome da empresa é obrigatório.");
  }

  return {
    ...input,
    name,
    segment: input.segment?.trim() || undefined,
    city: input.city?.trim() || undefined,
    state: input.state?.trim().toUpperCase() || undefined,
    website: input.website?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    instagram: input.instagram?.trim() || undefined,
    address: input.address?.trim() || undefined,
  };
}

export interface ImportResult {
  id: number;
  created: boolean;
  matchedBy?: string;
}

/**
 * Cria a empresa a menos que já exista (dedupe) e registra a origem.
 * Usado por Discovery e cadastro manual.
 */
export async function importCompany(
  rawInput: CreateCompanyInput,
  source: SourceType,
  rawData?: unknown,
): Promise<ImportResult> {
  const input = clean(rawInput);

  const duplicate =
    await findDuplicateCompanyRepository(input);

  if (duplicate) {
    return {
      id: duplicate.id,
      created: false,
      matchedBy: duplicate.matchedBy,
    };
  }

  const id = await createCompanyRepository(input);

  await addCompanySourceRepository(
    id,
    source,
    input.googlePlaceId,
    rawData,
  );

  return { id, created: true };
}

export async function createCompany(
  input: CreateCompanyInput,
): Promise<number> {
  const result = await importCompany(input, "MANUAL");

  if (!result.created) {
    throw new Error(
      `Empresa já cadastrada (mesmo ${result.matchedBy}).`,
    );
  }

  return result.id;
}

export async function listCompanies(
  limit = 200,
  offset = 0,
) {
  return listCompaniesRepository(limit, offset);
}

export function countCompanies() {
  return countCompaniesRepository();
}
