import {
  createCompanyRepository,
  listCompaniesRepository,
} from "./company.repository";

import type {
  CreateCompanyInput,
} from "./company.types";

export async function createCompany(
  input: CreateCompanyInput,
): Promise<void> {
  const name = input.name.trim();

  if (!name) {
    throw new Error(
      "O nome da empresa é obrigatório.",
    );
  }

  await createCompanyRepository({
    ...input,

    name,

    segment:
      input.segment?.trim() || undefined,

    city:
      input.city?.trim() || undefined,

    state:
      input.state
        ?.trim()
        .toUpperCase() || undefined,

    website:
      input.website?.trim() || undefined,

    phone:
      input.phone?.trim() || undefined,

    instagram:
      input.instagram?.trim() || undefined,
  });
}

export async function listCompanies() {
  return listCompaniesRepository();
}