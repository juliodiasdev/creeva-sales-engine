import { isCompanySuppressed } from "../compliance/suppression.service";

import {
  createProspectRepository,
  getProspectContextRepository,
  listProspectsRepository,
  prospectExistsForCompanyRepository,
} from "./prospect.repository";

import {
  setLeadStatusRepository,
} from "../companies/company.repository";

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

  if (await isCompanySuppressed(companyId)) {
    throw new Error(
      "Esta empresa pediu para não ser contatada (lista de supressão).",
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

  await setLeadStatusRepository(companyId, "READY");

  return prospectId;
}

export function listProspects() {
  return listProspectsRepository();
}

export function getProspect(id: number) {
  return getProspectContextRepository(id);
}
