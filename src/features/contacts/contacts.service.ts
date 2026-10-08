import { fetchByIds } from "../../lib/store";

import { listCompaniesRepository } from "../companies/company.repository";
import type { Company } from "../companies/company.types";

import { listChannelsForCompanies } from "./channels.repository";
import type { StoredChannel } from "./channels.repository";

import { listApproachesForCompanies } from "./approaches.repository";
import type { StoredApproach } from "./approaches.repository";

export interface ContactListItem {
  company: Company;
  channels: StoredChannel[];
  approaches: StoredApproach[];
  score: number | null;
}

/** Melhor abordagem para um canal: a da IA, senão a de template. */
export function bestApproach(
  approaches: StoredApproach[],
  channel: string,
): StoredApproach | undefined {
  const list = approaches.filter((a) => a.channel === channel);

  return list.find((a) => a.source === "AI") ?? list[0];
}

export async function loadContactList(
  limit = 300,
): Promise<ContactListItem[]> {
  const companies = await listCompaniesRepository(limit);

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

  const latestScore = new Map<number, { id: number; total: number }>();

  for (const s of scores) {
    const current = latestScore.get(Number(s.company_id));

    if (!current || Number(s.id) > current.id) {
      latestScore.set(Number(s.company_id), {
        id: Number(s.id),
        total: Number(s.total),
      });
    }
  }

  return companies.map((company) => ({
    company,
    channels: channels.filter((c) => Number(c.company_id) === Number(company.id)),
    approaches: approaches.filter((a) => Number(a.company_id) === Number(company.id)),
    score: latestScore.get(Number(company.id))?.total ?? null,
  }));
}
