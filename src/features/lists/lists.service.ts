import type { Company } from "../companies/company.types";

import { createProspect } from "../prospects/prospect.service";
import { getNumberSetting } from "../settings/settings.service";

import {
  deleteListRepository,
  getListRepository,
  listCompaniesByIdsRepository,
  listCompaniesOfListRepository,
  listCompanyStagesRepository,
  listListsRepository,
  setCompaniesLeadStatusRepository,
  updateListRepository,
} from "./lists.repository";

import type { CompanyStage, ProspectList } from "./lists.repository";

import { listChannelsForCompanies } from "../contacts/channels.repository";
import type { StoredChannel } from "../contacts/channels.repository";
import { listApproachesForCompanies } from "../contacts/approaches.repository";
import type { StoredApproach } from "../contacts/approaches.repository";
import { fetchByIds } from "../../lib/store";

/** Etapas do processo de uma empresa dentro de uma lista. */
export interface ListStats {
  total: number;
  /** 1. Captadas do Google Maps, ainda sem enriquecer */
  discovered: number;
  /** enriquecimento em andamento */
  enriching: number;
  /** 2. Enriquecidas, aguardando decisão */
  enriched: number;
  /** 3. Qualificadas, prontas para abordar */
  qualified: number;
  /** 4. Em abordagem (viraram prospect) */
  ready: number;
  disqualified: number;
}

const emptyStats = (): ListStats => ({
  total: 0,
  discovered: 0,
  enriching: 0,
  enriched: 0,
  qualified: 0,
  ready: 0,
  disqualified: 0,
});

const KEY: Record<Company["lead_status"], keyof ListStats> = {
  DISCOVERED: "discovered",
  ENRICHING: "enriching",
  ENRICHED: "enriched",
  QUALIFIED: "qualified",
  READY: "ready",
  DISQUALIFIED: "disqualified",
};

export function countStages(stages: Pick<CompanyStage, "lead_status">[]): ListStats {
  const stats = emptyStats();

  for (const s of stages) {
    stats.total++;
    stats[KEY[s.lead_status] ?? "discovered"]++;
  }

  return stats;
}

export interface ListWithStats {
  list: ProspectList;
  stats: ListStats;
  next: NextStep;
}

/** O que fazer agora nesta lista (guia o processo em ciclo). */
export interface NextStep {
  /** 1 captar · 2 enriquecer · 3 qualificar · 4 abordar · 5 acompanhar */
  step: 2 | 3 | 4 | 5 | 6;
  title: string;
  detail: string;
  count: number;
}

export function nextStep(stats: ListStats): NextStep {
  if (stats.discovered > 0) {
    return {
      step: 2,
      title: "Enriquecer",
      detail: `${stats.discovered} empresa(s) captada(s) esperando enriquecimento`,
      count: stats.discovered,
    };
  }

  if (stats.enriched > 0) {
    return {
      step: 3,
      title: "Qualificar",
      detail: `${stats.enriched} empresa(s) enriquecida(s) esperando sua decisão`,
      count: stats.enriched,
    };
  }

  if (stats.qualified > 0) {
    return {
      step: 4,
      title: "Iniciar abordagem",
      detail: `${stats.qualified} empresa(s) qualificada(s) prontas para abordar`,
      count: stats.qualified,
    };
  }

  if (stats.ready > 0) {
    return {
      step: 5,
      title: "Acompanhar",
      detail: `${stats.ready} empresa(s) em abordagem: siga pelas tarefas de Hoje`,
      count: stats.ready,
    };
  }

  return {
    step: 6,
    title: "Concluída",
    detail: "Todas as empresas desta lista foram tratadas",
    count: 0,
  };
}

export async function loadListsWithStats(): Promise<ListWithStats[]> {
  const [lists, stages] = await Promise.all([
    listListsRepository(),
    listCompanyStagesRepository(),
  ]);

  const byList = new Map<number, CompanyStage[]>();

  for (const s of stages) {
    if (s.list_id === null) continue;

    const id = Number(s.list_id);
    byList.set(id, [...(byList.get(id) ?? []), s]);
  }

  return lists.map((list) => {
    const stats = countStages(byList.get(Number(list.id)) ?? []);

    return { list, stats, next: nextStep(stats) };
  });
}

export interface ListItem {
  company: Company;
  channels: StoredChannel[];
  approaches: StoredApproach[];
  score: number | null;
}

export async function loadListItems(listId: number): Promise<ListItem[]> {
  const companies = await listCompaniesOfListRepository(listId);
  const ids = companies.map((c) => Number(c.id));

  const [channels, approaches, scores] = await Promise.all([
    listChannelsForCompanies(ids),
    listApproachesForCompanies(ids),
    fetchByIds<{ id: number; company_id: number; total: number }>(
      "company_scores",
      "id,company_id,total",
      "company_id",
      ids,
    ),
  ]);

  const latest = new Map<number, { id: number; total: number }>();

  for (const s of scores) {
    const cur = latest.get(Number(s.company_id));

    if (!cur || Number(s.id) > cur.id) {
      latest.set(Number(s.company_id), {
        id: Number(s.id),
        total: Number(s.total),
      });
    }
  }

  return companies.map((company) => ({
    company,
    channels: channels.filter((c) => Number(c.company_id) === Number(company.id)),
    approaches: approaches.filter((a) => Number(a.company_id) === Number(company.id)),
    score: latest.get(Number(company.id))?.total ?? null,
  }));
}

/* ---------- ações em lote (cada uma exige decisão do usuário) ---------- */

export interface BulkResult {
  done: number;
  skipped: number;
}

async function pick(
  ids: number[],
  allowed: Company["lead_status"][],
): Promise<{ ok: number[]; skipped: number }> {
  const companies = await listCompaniesByIdsRepository(ids);
  const ok = companies
    .filter((c) => allowed.includes(c.lead_status))
    .map((c) => Number(c.id));

  return { ok, skipped: ids.length - ok.length };
}

/** Passo 3: o usuário aprova empresas para abordagem. */
export async function qualifyCompanies(ids: number[]): Promise<BulkResult> {
  const { ok, skipped } = await pick(ids, ["DISCOVERED", "ENRICHED"]);

  await setCompaniesLeadStatusRepository(ok, "QUALIFIED");

  return { done: ok.length, skipped };
}

/** Descarta com motivo registrado (obrigatório). */
export async function discardCompanies(
  ids: number[],
  reason: string,
): Promise<BulkResult> {
  const text = reason.trim();

  if (!text) throw new Error("Informe o motivo do descarte.");

  const { ok, skipped } = await pick(ids, [
    "DISCOVERED",
    "ENRICHED",
    "QUALIFIED",
  ]);

  await setCompaniesLeadStatusRepository(ok, "DISQUALIFIED", text);

  return { done: ok.length, skipped };
}

/** Devolve ao fluxo uma empresa descartada. */
export async function restoreCompanies(ids: number[]): Promise<BulkResult> {
  const { ok, skipped } = await pick(ids, ["DISQUALIFIED"]);

  await setCompaniesLeadStatusRepository(ok, "DISCOVERED");

  return { done: ok.length, skipped };
}

/** Passo 4: só empresas QUALIFICADAS viram prospect (com 1ª tarefa). */
export async function startOutreach(ids: number[]): Promise<BulkResult> {
  const { ok, skipped } = await pick(ids, ["QUALIFIED"]);
  let done = 0;
  let failed = 0;

  for (const id of ok) {
    try {
      await createProspect(id);
      done++;
    } catch {
      failed++;
    }
  }

  return { done, skipped: skipped + failed };
}

/** Enriquecidas com pontuação >= mínimo configurado (sugestão, não decisão). */
export async function recommendedToQualify(
  items: ListItem[],
): Promise<number[]> {
  const min = await getNumberSetting("min_score", 50);

  return items
    .filter(
      (i) =>
        i.company.lead_status === "ENRICHED" &&
        i.score !== null &&
        i.score >= min,
    )
    .map((i) => Number(i.company.id));
}

export async function archiveList(id: number, archived: boolean) {
  await updateListRepository(id, { status: archived ? "ARCHIVED" : "OPEN" });
}

export async function renameList(id: number, name: string) {
  if (!name.trim()) throw new Error("O nome da lista não pode ficar vazio.");

  await updateListRepository(id, { name: name.trim() });
}

/** Exclui a lista; as empresas permanecem na base (sem lista). */
export async function removeList(id: number) {
  if (!(await getListRepository(id))) throw new Error("Lista não encontrada.");

  await deleteListRepository(id);
}

/* ---------- visão geral do processo (tela "Hoje") ---------- */

export interface ProcessOverview {
  openLists: number;
  discovered: number;
  enriched: number;
  qualified: number;
  ready: number;
  /** Lista com mais itens pendentes em cada etapa (para ir direto). */
  best: { discovered?: number; enriched?: number; qualified?: number };
}

export async function getProcessOverview(): Promise<ProcessOverview> {
  const all = await loadListsWithStats();
  const open = all.filter((l) => l.list.status === "OPEN");

  const sum = (k: keyof ListStats) =>
    open.reduce((n, l) => n + l.stats[k], 0);

  const top = (k: keyof ListStats) =>
    [...open]
      .filter((l) => l.stats[k] > 0)
      .sort((a, b) => b.stats[k] - a.stats[k])[0]?.list.id;

  return {
    openLists: open.length,
    discovered: sum("discovered"),
    enriched: sum("enriched"),
    qualified: sum("qualified"),
    ready: sum("ready"),
    best: {
      discovered: top("discovered"),
      enriched: top("enriched"),
      qualified: top("qualified"),
    },
  };
}
