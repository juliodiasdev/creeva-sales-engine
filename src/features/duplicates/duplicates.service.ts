import {
  fetchAllPages,
  getSupabase,
  nowIso,
  unwrap,
} from "../../lib/store";

import {
  buildDedupeKey,
  normalizeDomain,
  normalizePhone,
} from "../../lib/normalize";

import type { Company } from "../companies/company.types";
import { createActivityRepository } from "../activities/activity.repository";

import { markPlaceSeen } from "../discovery/discovery.repository";
import { openaiChatJson } from "../ai/openai.client";
import type { ChatJson } from "../ai/openai.client";

import { findDuplicateGroups } from "./duplicates.engine";
import type {
  CompanyBrief,
  DuplicateGroup,
} from "./duplicates.engine";

export async function scanDuplicates(): Promise<DuplicateGroup[]> {
  const companies = await fetchAllPages<CompanyBrief>((from, to) =>
    getSupabase()
      .from("companies")
      .select(
        "id,name,city,address,phone_normalized,domain,cnpj,google_place_id,website,phone,lead_status",
      )
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  return findDuplicateGroups(companies.map((c) => ({ ...c, id: Number(c.id) })));
}

export interface AiVerdict {
  same_entity: boolean;
  master_id: number;
  confidence: number;
  reason: string;
}

/** Valida a resposta da IA: o master tem de pertencer ao grupo. */
export function validateVerdict(
  raw: unknown,
  memberIds: number[],
): AiVerdict {
  const obj = raw as Record<string, unknown> | null;

  if (!obj || typeof obj !== "object") {
    throw new Error("Resposta da IA inválida.");
  }

  const masterId = Number(obj.master_id);
  const confidence = Number(obj.confidence);

  if (typeof obj.same_entity !== "boolean") {
    throw new Error("A IA não informou se são a mesma empresa.");
  }

  if (!memberIds.includes(masterId)) {
    throw new Error("A IA escolheu um registro fora do grupo.");
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error("Confiança da IA fora de 0–1.");
  }

  return {
    same_entity: obj.same_entity,
    master_id: masterId,
    confidence,
    reason: String(obj.reason ?? "").slice(0, 400),
  };
}

/** A IA decide se o grupo é a mesma empresa e qual registro é o principal. */
export async function confirmGroupWithAi(
  group: DuplicateGroup,
  chat: ChatJson = openaiChatJson,
): Promise<AiVerdict> {
  const records = group.members.map((m) => ({
    id: m.id,
    nome: m.name,
    cidade: m.city,
    endereco: m.address,
    telefone: m.phone,
    site: m.website,
    cnpj: m.cnpj,
  }));

  const { json } = await chat([
    {
      role: "system",
      content:
        "Você organiza uma base de contatos comerciais. Decida SOMENTE com os dados fornecidos, sem inventar. Na dúvida, responda same_entity=false. Responda apenas JSON válido.",
    },
    {
      role: "user",
      content: `Os registros abaixo são a MESMA empresa (duplicados)? Se sim, escolha o registro mais completo e confiável como principal (master_id). Responda {"same_entity": boolean, "master_id": number, "confidence": 0-1, "reason": string}.\n${JSON.stringify(records)}`,
    },
  ]);

  return validateVerdict(
    json,
    group.members.map((m) => m.id),
  );
}

const FILL_FIELDS = [
  "segment",
  "city",
  "state",
  "website",
  "phone",
  "instagram",
  "address",
  "category",
  "legal_name",
  "cnae",
  "company_size",
  "registration_status",
  "opened_at",
  "capital",
  "rating",
  "reviews_count",
] as const;

const CHILD_TABLES = [
  "company_sources",
  "website_snapshots",
  "company_scores",
  "ai_analyses",
] as const;

const PROSPECT_CHILDREN = [
  "tasks",
  "activities",
  "deals",
  "meetings",
  "proposals",
] as const;

export interface MergeResult {
  masterId: number;
  removedId: number;
  prospectsMerged: boolean;
}

/**
 * Mescla `duplicateId` em `masterId`. Os dados do duplicado são
 * preservados (histórico, fontes, tarefas); só depois ele é removido.
 * A ordem torna a operação reexecutável se algo falhar no meio.
 */
export async function mergeCompanies(
  masterId: number,
  duplicateId: number,
): Promise<MergeResult> {
  if (masterId === duplicateId) {
    throw new Error("Escolha dois registros diferentes.");
  }

  const supabase = getSupabase();

  const load = async (id: number) =>
    unwrap(
      await supabase
        .from("companies")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
    ) as Company | null;

  const [master, dup] = await Promise.all([
    load(masterId),
    load(duplicateId),
  ]);

  if (!master || !dup) throw new Error("Empresa não encontrada.");

  const prospectOf = async (companyId: number) =>
    unwrap(
      await supabase
        .from("prospects")
        .select("id")
        .eq("company_id", companyId)
        .maybeSingle(),
    ) as { id: number } | null;

  const [masterProspect, dupProspect] = await Promise.all([
    prospectOf(masterId),
    prospectOf(duplicateId),
  ]);

  // 1) histórico e fontes do duplicado passam para o principal
  for (const table of CHILD_TABLES) {
    unwrap(
      await supabase
        .from(table)
        .update({ company_id: masterId })
        .eq("company_id", duplicateId),
    );
  }

  // sinais são recalculados no próximo enriquecimento
  unwrap(
    await supabase.from("signals").delete().eq("company_id", duplicateId),
  );

  // 2) prospect
  let prospectsMerged = false;

  if (dupProspect && !masterProspect) {
    unwrap(
      await supabase
        .from("prospects")
        .update({ company_id: masterId })
        .eq("id", dupProspect.id),
    );
  } else if (dupProspect && masterProspect) {
    for (const table of PROSPECT_CHILDREN) {
      unwrap(
        await supabase
          .from(table)
          .update({ prospect_id: masterProspect.id })
          .eq("prospect_id", dupProspect.id),
      );
    }

    unwrap(
      await supabase.from("prospects").delete().eq("id", dupProspect.id),
    );

    prospectsMerged = true;
  }

  // O lugar do Google do duplicado fica registrado para sempre,
  // apontando para o principal: nunca será coletado de novo.
  if (dup.google_place_id) {
    await markPlaceSeen(dup.google_place_id, masterId);
  }

  // 3) remove o duplicado (libera campos únicos: place id, CNPJ)
  unwrap(
    await supabase.from("companies").delete().eq("id", duplicateId),
  );

  // 4) completa o principal com o que só o duplicado tinha
  const filled: Record<string, unknown> = {};

  for (const field of FILL_FIELDS) {
    if (master[field] == null && dup[field] != null) {
      filled[field] = dup[field];
    }
  }

  if (master.cnpj == null && dup.cnpj != null) filled.cnpj = dup.cnpj;

  if (master.google_place_id == null && dup.google_place_id != null) {
    filled.google_place_id = dup.google_place_id;
  }

  if (dupProspect && !masterProspect) filled.lead_status = "READY";

  const website = (filled.website as string) ?? master.website;
  const phone = (filled.phone as string) ?? master.phone;

  unwrap(
    await supabase
      .from("companies")
      .update({
        ...filled,
        domain: normalizeDomain(website),
        phone_normalized: normalizePhone(phone),
        dedupe_key: buildDedupeKey(
          master.name,
          (filled.address as string) ?? master.address,
          (filled.city as string) ?? master.city,
        ),
        updated_at: nowIso(),
      })
      .eq("id", masterId),
  );

  const finalProspect = masterProspect ?? dupProspect;

  if (finalProspect) {
    await createActivityRepository(
      finalProspect.id,
      "STATUS_CHANGED",
      `Cadastro duplicado mesclado: "${dup.name}" (#${dup.id}) → "${master.name}" (#${master.id}).`,
      undefined,
      { merged_company_id: dup.id },
    );
  }

  return { masterId, removedId: duplicateId, prospectsMerged };
}
