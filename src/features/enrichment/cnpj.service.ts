import { httpFetch } from "../../lib/http";
import { normalizeCnpj } from "../../lib/normalize";

import {
  addCompanySourceRepository,
  getCompanyRepository,
  updateCompanyEnrichmentRepository,
} from "../companies/company.repository";

import { recordApiUsage } from "../jobs/apiUsage.service";

interface BrasilApiCnpj {
  razao_social?: string;
  nome_fantasia?: string;
  cnae_fiscal_descricao?: string;
  descricao_situacao_cadastral?: string;
  data_inicio_atividade?: string;
  porte?: string;
  capital_social?: number;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
}

/** Mapeia apenas campos presentes; não preenche nada que a API não devolveu. */
export function mapCnpjResponse(data: BrasilApiCnpj) {
  const address = [
    data.logradouro,
    data.numero,
    data.bairro,
    data.municipio && data.uf
      ? `${data.municipio}-${data.uf}`
      : undefined,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    legal_name: data.razao_social || undefined,
    cnae: data.cnae_fiscal_descricao || undefined,
    company_size: data.porte || undefined,
    registration_status:
      data.descricao_situacao_cadastral || undefined,
    opened_at: data.data_inicio_atividade || undefined,
    capital: data.capital_social,
    address: address || undefined,
  };
}

export async function enrichCompanyWithCnpj(
  companyId: number,
  cnpjInput: string,
): Promise<void> {
  const cnpj = normalizeCnpj(cnpjInput);

  if (!cnpj) throw new Error("CNPJ inválido (14 dígitos).");

  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const response = await httpFetch(
    `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
  );

  await recordApiUsage({
    provider: "CNPJ",
    operation: "lookup",
  });

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "CNPJ não encontrado."
        : `Consulta de CNPJ falhou (${response.status}).`,
    );
  }

  const data = (await response.json()) as BrasilApiCnpj;

  await updateCompanyEnrichmentRepository(companyId, {
    cnpj,
    ...mapCnpjResponse(data),
  });

  await addCompanySourceRepository(companyId, "CNPJ", cnpj, data);
}
