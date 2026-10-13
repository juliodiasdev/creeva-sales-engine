import { getLatestAnalysis, parseBottlenecks } from "../ai/ai.service";
import { getCompanyRepository } from "../companies/company.repository";
import type { Company } from "../companies/company.types";
import {
  listChannelsForCompanies,
  listChannelsRepository,
} from "../contacts/channels.repository";
import type { StoredChannel } from "../contacts/channels.repository";
import { listCompaniesOfListRepository } from "../lists/lists.repository";
import { formatPhone } from "../../lib/format";
import { isGenericHost, normalizeDomain, normalizePhone, socialProfile } from "../../lib/normalize";
import { label, SIGNAL_LABEL, SOURCE_LABEL } from "../../lib/labels";

import { listPresenceSummaries } from "../presence/presence.service";
import type { PresenceLevel, SaleMoment } from "../presence/presence.engine";
import { listSignalsRepository } from "./enrichment.repository";
import {
  listFindingsForCompanies,
  listFindingsRepository,
} from "./findings.repository";
import type { StoredFinding } from "./findings.repository";
import type { FindingField } from "./findings.validation";

export type FichaKey =
  | "WEBSITE"
  | "PHONE"
  | "WHATSAPP"
  | "EMAIL"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK"
  | "ADDRESS"
  | "CATEGORY"
  | "RATING"
  | "CNPJ";

/** OK = tem · PARTIAL = tem, mas falta confirmar · SUGGESTED = a IA sugeriu, você decide · MISSING = não tem */
export type FichaStatus = "OK" | "PARTIAL" | "SUGGESTED" | "MISSING";

export interface FichaRow {
  key: FichaKey;
  label: string;
  group: "Contato" | "Redes sociais" | "Dados da empresa";
  status: FichaStatus;
  value: string | null;
  /** De onde veio o dado (Google Maps, site da empresa, busca com IA, CNPJ...). */
  source: string | null;
  /** O que fazer a respeito (vazio quando está completo). */
  action: string | null;
  /** Outros valores reais encontrados para o mesmo campo. */
  extras: string[];
  findings: StoredFinding[];
}

/** Colunas da visão geral da lista (as mais importantes para vender). */
export const CORE_KEYS: FichaKey[] = [
  "WEBSITE",
  "PHONE",
  "WHATSAPP",
  "EMAIL",
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "CNPJ",
];

export const FICHA_LABEL: Record<FichaKey, string> = {
  WEBSITE: "Site",
  PHONE: "Telefone",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  ADDRESS: "Endereço",
  CATEGORY: "Categoria",
  RATING: "Avaliação no Google",
  CNPJ: "CNPJ",
};

const GROUP: Record<FichaKey, FichaRow["group"]> = {
  WEBSITE: "Contato",
  PHONE: "Contato",
  WHATSAPP: "Contato",
  EMAIL: "Contato",
  INSTAGRAM: "Redes sociais",
  FACEBOOK: "Redes sociais",
  LINKEDIN: "Redes sociais",
  YOUTUBE: "Redes sociais",
  TIKTOK: "Redes sociais",
  ADDRESS: "Dados da empresa",
  CATEGORY: "Dados da empresa",
  RATING: "Dados da empresa",
  CNPJ: "Dados da empresa",
};

const MISSING_ACTION: Record<FichaKey, string> = {
  WEBSITE: "Buscar o site oficial com a IA (ou cadastrar à mão).",
  PHONE: "Buscar um telefone público com a IA.",
  WHATSAPP: "Buscar o WhatsApp com a IA ou ler o site da empresa.",
  EMAIL: "Ler o site da empresa ou buscar com a IA.",
  INSTAGRAM: "Buscar o perfil com a IA ou ler o site.",
  FACEBOOK: "Buscar a página com a IA ou ler o site.",
  LINKEDIN: "Buscar a página da empresa com a IA.",
  YOUTUBE: "Opcional: buscar o canal com a IA.",
  TIKTOK: "Opcional: buscar o perfil com a IA.",
  ADDRESS: "O Google não informou o endereço.",
  CATEGORY: "O Google não informou a categoria.",
  RATING: "O Google não tem avaliações desta empresa.",
  CNPJ: "Informe o CNPJ na página da empresa para consultar razão social e situação (o app nunca inventa o CNPJ).",
};

const CHANNEL_KEYS: FindingField[] = [
  "WEBSITE",
  "PHONE",
  "WHATSAPP",
  "EMAIL",
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
];

const show = (key: FichaKey, value: string): string =>
  key === "PHONE" || key === "WHATSAPP"
    ? /^\d+$/.test(value)
      ? formatPhone(value)
      : value.startsWith("msg/")
        ? "link de conversa"
        : value
    : key === "INSTAGRAM" || key === "TIKTOK"
      ? `@${value.replace(/^@/, "")}`
      : value;

/** Monta a tabela "o que tem / o que falta" de UMA empresa (função pura). */
export function buildFichaRows(
  company: Company,
  channels: Pick<StoredChannel, "kind" | "value" | "label" | "source">[],
  findings: StoredFinding[],
): FichaRow[] {
  const pending = (key: FichaKey) =>
    findings.filter((f) => f.field === key && f.status === "SUGGESTED");

  const rows: FichaRow[] = [];

  for (const key of CHANNEL_KEYS) {
    const mine = channels.filter((c) => c.kind === key);
    const sugg = pending(key);
    const websiteIsSocial = key === "WEBSITE" && !!company.website && isGenericHost(company.website);

    // Site: o cadastro vale se não for só um link de rede social.
    const websiteValue =
      key === "WEBSITE" && company.website && !websiteIsSocial
        ? normalizeDomain(company.website)
        : null;

    // Dados do cadastro (Google Maps) valem mesmo antes de o enriquecimento criar os canais.
    const registered: { value: string; label: string | null; source: string }[] = [];

    if (websiteValue) registered.push({ value: websiteValue, label: null, source: "GOOGLE_PLACES" });

    if (key === "PHONE" && normalizePhone(company.phone)) {
      registered.push({ value: normalizePhone(company.phone)!, label: null, source: "GOOGLE_PLACES" });
    }

    if (key === "INSTAGRAM" && company.instagram) {
      const profile = socialProfile(
        company.instagram.startsWith("@") ? `instagram.com/${company.instagram.slice(1)}` : company.instagram,
      );

      if (profile?.kind === "INSTAGRAM") registered.push({ value: profile.handle, label: null, source: "MANUAL" });
    }

    const values = [
      ...mine.map((c) => ({ value: c.value, label: c.label, source: c.source })),
      ...registered,
    ];

    const unique = values.filter(
      (v, i) => values.findIndex((w) => w.value === v.value) === i,
    );

    const primary = unique[0];
    const probable = key === "WHATSAPP" && !!primary && !!primary.label?.startsWith("provável");

    rows.push({
      key,
      label: FICHA_LABEL[key],
      group: GROUP[key],
      status: primary
        ? probable
          ? "PARTIAL"
          : "OK"
        : sugg.length > 0
          ? "SUGGESTED"
          : "MISSING",
      value: primary ? show(key, primary.value) : sugg[0] ? show(key, sugg[0].value) : null,
      source: primary ? label(SOURCE_LABEL, primary.source) : null,
      action: primary
        ? probable
          ? "Celular do Google: ainda não foi confirmado como WhatsApp. Leia o site ou busque com a IA."
          : null
        : sugg.length > 0
          ? "Revise a sugestão da IA e aceite ou rejeite."
          : websiteIsSocial
            ? "O cadastro só tem um link de rede social. Busque o site oficial com a IA."
            : MISSING_ACTION[key],
      extras: unique.slice(1).map((v) => show(key, v.value)),
      findings: sugg,
    });
  }

  const simple = (
    key: FichaKey,
    value: string | null,
    source: string,
    format?: (v: string) => string,
  ): FichaRow => ({
    key,
    label: FICHA_LABEL[key],
    group: GROUP[key],
    status: value ? "OK" : "MISSING",
    value: value ? (format ? format(value) : value) : null,
    source: value ? source : null,
    action: value ? null : MISSING_ACTION[key],
    extras: [],
    findings: [],
  });

  rows.push(
    simple("ADDRESS", company.address, "Google Maps"),
    simple("CATEGORY", company.category ?? company.segment, "Google Maps"),
    simple(
      "RATING",
      company.rating !== null && company.rating !== undefined
        ? `${company.rating} (${company.reviews_count ?? 0} avaliações)`
        : null,
      "Google Maps",
    ),
    simple("CNPJ", company.cnpj, "Consulta de CNPJ"),
  );

  return rows;
}

/** Campos que a busca com IA pode procurar: os que faltam e ainda sem sugestão pendente. */
export function missingForSearch(rows: FichaRow[]): FindingField[] {
  return rows
    .filter(
      (r) =>
        r.status === "MISSING" &&
        (CHANNEL_KEYS as string[]).includes(r.key),
    )
    .map((r) => r.key as FindingField);
}

export interface Improvement {
  /** Oportunidade de negócio que a Creava resolve (os dados que faltam ficam na tabela de dados). */
  kind: "NEGÓCIO";
  title: string;
  evidence: string;
  suggestion: string;
  origin: "Análise do site" | "Diagnóstico da IA";
}

const SIGNAL_SUGGESTION: Record<string, string> = {
  NO_WEBSITE: "Criar um site ou landing page para a empresa ser encontrada e gerar contatos.",
  NO_HTTPS: "Renovar o site com certificado de segurança (cadeado) para passar confiança.",
  NO_WHATSAPP: "Colocar um botão de WhatsApp no site para o cliente chamar na hora.",
  NO_CLEAR_CTA: "Incluir um botão claro de ação (agendar, pedir orçamento) na página inicial.",
  NO_FORM: "Criar um formulário de contato para captar clientes fora do horário.",
  OUTDATED_COPYRIGHT: "Atualizar o site: o rodapé indica que está parado há anos.",
  LOW_REVIEWS: "Ajudar a empresa a conseguir mais avaliações no Google.",
  BROKEN_LINK: "Recolocar o site no ar: o endereço atual não abre.",
  WEAK_CONVERSION_PATH: "Encurtar o caminho do visitante até o contato.",
  NO_MOBILE_SIGNAL: "Adaptar o site para funcionar bem no celular.",
};

/** O que melhorar no NEGÓCIO da empresa (separado dos dados que faltam). */
export async function loadImprovements(companyId: number): Promise<Improvement[]> {
  const [signals, analysis] = await Promise.all([
    listSignalsRepository(companyId),
    getLatestAnalysis(companyId),
  ]);

  const fromSignals: Improvement[] = signals.map((s) => ({
    kind: "NEGÓCIO",
    title: SIGNAL_LABEL[s.type] ?? s.type,
    evidence: s.evidence,
    suggestion: SIGNAL_SUGGESTION[s.type] ?? "Avaliar a melhoria com a equipe.",
    origin: "Análise do site",
  }));

  const fromAi: Improvement[] = parseBottlenecks(analysis).map((b) => ({
    kind: "NEGÓCIO",
    title: b.title,
    evidence: b.evidence.map((e) => SIGNAL_LABEL[e] ?? e).join(", "),
    suggestion: b.impact,
    origin: "Diagnóstico da IA",
  }));

  return [...fromSignals, ...fromAi];
}

export interface Ficha {
  company: Company;
  rows: FichaRow[];
  improvements: Improvement[];
  missing: FindingField[];
  /** Quantos dos campos principais estão completos. */
  completeness: { ok: number; total: number };
}

export const completenessOf = (rows: FichaRow[]) => ({
  ok: rows.filter((r) => CORE_KEYS.includes(r.key) && r.status === "OK").length,
  total: CORE_KEYS.length,
});

export async function loadFicha(companyId: number): Promise<Ficha> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const [channels, findings, improvements] = await Promise.all([
    listChannelsRepository(companyId),
    listFindingsRepository(companyId),
    loadImprovements(companyId),
  ]);

  const rows = buildFichaRows(company, channels, findings);

  return {
    company,
    rows,
    improvements,
    missing: missingForSearch(rows),
    completeness: completenessOf(rows),
  };
}

/* ---------- visão geral da lista: empresas x campos ---------- */

export interface ListFichaRow {
  companyId: number;
  name: string;
  leadStatus: Company["lead_status"];
  cells: Record<string, FichaStatus>;
  ok: number;
  total: number;
  pendingSuggestions: number;
  /** Presença digital já avaliada (null = ainda não avaliada). */
  presence: { score: number | null; level: PresenceLevel; moment: SaleMoment } | null;
}

export async function loadListFicha(listId: number): Promise<ListFichaRow[]> {
  const companies = await listCompaniesOfListRepository(listId);
  const ids = companies.map((c) => Number(c.id));

  const [channels, findings, presence] = await Promise.all([
    listChannelsForCompanies(ids),
    listFindingsForCompanies(ids),
    listPresenceSummaries(ids),
  ]);

  return companies.map((company) => {
    const mine = channels.filter((c) => Number(c.company_id) === Number(company.id));
    const found = findings.filter((f) => Number(f.company_id) === Number(company.id));
    const rows = buildFichaRows(company, mine, found);
    const { ok, total } = completenessOf(rows);

    return {
      companyId: Number(company.id),
      name: company.name,
      leadStatus: company.lead_status,
      cells: Object.fromEntries(
        CORE_KEYS.map((k) => [k, rows.find((r) => r.key === k)!.status]),
      ),
      ok,
      total,
      pendingSuggestions: found.filter((f) => f.status === "SUGGESTED").length,
      presence: presence.get(Number(company.id)) ?? null,
    };
  });
}
