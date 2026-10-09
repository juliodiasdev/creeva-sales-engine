import { fetchAllPages, getSupabase } from "../../lib/store";

import { listAllMessagesRepository } from "./agent.repository";

export interface ServiceFunnelRow {
  /** Chave do serviço da Creava ("SEM_SERVICO" quando não definido). */
  serviceKey: string;
  prospects: number;
  contacted: number;
  replied: number;
  meetings: number;
  proposals: number;
  won: number;
}

export interface LearningSummary {
  byService: ServiceFunnelRow[];
  /** Mensagens do agente enviadas (aprovadas) e quantas o vendedor editou. */
  aiSent: number;
  aiEdited: number;
  /** Total de conversas com pelo menos uma resposta do contato. */
  conversationsWithReply: number;
}

const NONE = "SEM_SERVICO";

/**
 * Aprendizado do funil com dados REAIS: onde cada serviço converte e
 * quanto o vendedor precisa corrigir o agente. Nada é estimado.
 */
export async function getLearningSummary(): Promise<LearningSummary> {
  const supabase = getSupabase();

  const prospects = await fetchAllPages<{
    id: number;
    company_id: number;
    status: string;
  }>((from, to) =>
    supabase
      .from("prospects")
      .select("id,company_id,status")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  const activities = await fetchAllPages<{ prospect_id: number; type: string }>(
    (from, to) =>
      supabase
        .from("activities")
        .select("prospect_id,type")
        .order("id", { ascending: true })
        .range(from, to) as never,
  );

  const analyses = await fetchAllPages<{
    id: number;
    company_id: number;
    recommended_services: string | null;
  }>((from, to) =>
    supabase
      .from("ai_analyses")
      .select("id,company_id,recommended_services")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  const approaches = await fetchAllPages<{
    id: number;
    company_id: number;
    service_key: string | null;
  }>((from, to) =>
    supabase
      .from("company_approaches")
      .select("id,company_id,service_key")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  // Serviço principal por empresa: recomendação da IA; senão a 1ª abordagem.
  const serviceOf = new Map<number, string>();

  for (const a of approaches) {
    if (a.service_key && !serviceOf.has(Number(a.company_id))) {
      serviceOf.set(Number(a.company_id), a.service_key);
    }
  }

  for (const a of analyses) {
    try {
      const list = JSON.parse(a.recommended_services ?? "[]") as {
        service_key?: string;
      }[];

      if (list[0]?.service_key) {
        serviceOf.set(Number(a.company_id), list[0].service_key);
      }
    } catch {
      // análise antiga sem serviços
    }
  }

  const had = (type: string) =>
    new Set(
      activities.filter((a) => a.type === type).map((a) => Number(a.prospect_id)),
    );

  const contacted = had("MESSAGE_SENT");
  const replied = had("REPLY_RECEIVED");
  const meetings = had("MEETING");
  const proposals = had("PROPOSAL_SENT");

  const rows = new Map<string, ServiceFunnelRow>();

  for (const p of prospects) {
    const key = serviceOf.get(Number(p.company_id)) ?? NONE;
    const row =
      rows.get(key) ??
      {
        serviceKey: key,
        prospects: 0,
        contacted: 0,
        replied: 0,
        meetings: 0,
        proposals: 0,
        won: 0,
      };

    const id = Number(p.id);

    row.prospects++;
    if (contacted.has(id)) row.contacted++;
    if (replied.has(id)) row.replied++;
    if (meetings.has(id)) row.meetings++;
    if (proposals.has(id)) row.proposals++;
    if (p.status === "WON") row.won++;

    rows.set(key, row);
  }

  const messages = await listAllMessagesRepository();
  const aiSent = messages.filter(
    (m) => m.author === "AI" && m.status === "SENT",
  );

  return {
    byService: [...rows.values()].sort((a, b) => b.prospects - a.prospects),
    aiSent: aiSent.length,
    aiEdited: aiSent.filter((m) => Number(m.edited) === 1).length,
    conversationsWithReply: new Set(
      messages.filter((m) => m.direction === "IN").map((m) => Number(m.company_id)),
    ).size,
  };
}
