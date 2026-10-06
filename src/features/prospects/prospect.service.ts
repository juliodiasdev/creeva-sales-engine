import {
  createProspectRepository,
  listProspectsRepository,
  prospectExistsForCompanyRepository,
} from "./prospect.repository";

import {
  createTaskRepository,
} from "../tasks/task.repository";

import {
  createActivityRepository,
} from "../activities/activity.repository";

export async function createProspect(
  companyId: number,
): Promise<number> {
  if (!companyId) {
    throw new Error(
      "Empresa inválida.",
    );
  }

  const exists =
    await prospectExistsForCompanyRepository(
      companyId,
    );

  if (exists) {
    throw new Error(
      "Esta empresa já está na prospecção.",
    );
  }

  const prospectId =
    await createProspectRepository(
      companyId,
    );

  await createTaskRepository(
    prospectId,
    "FIRST_CONTACT",
    "Realizar primeiro contato",
  );

  await createActivityRepository(
    prospectId,
    "PROSPECT_CREATED",
    "Empresa adicionada à prospecção.",
  );

  return prospectId;
}

export function listProspects() {
  return listProspectsRepository();
}