import { fetchAllPages, getSupabase } from "../../lib/store";

/** Ligações em que alguém da empresa atendeu: contam como contato feito. */
const ANSWERED = ["CALLBACK", "INTERESTED", "NOT_INTERESTED", "DO_NOT_CONTACT"];

/**
 * Prospects que já receberam um contato real: mensagem enviada ou
 * ligação atendida (ligação sem resposta ou número errado não contam).
 */
export async function contactedProspectIds(): Promise<Set<number>> {
  const rows = await fetchAllPages<{
    prospect_id: number;
    type: string;
    metadata: string | null;
  }>((from, to) =>
    getSupabase()
      .from("activities")
      .select("prospect_id,type,metadata")
      .in("type", ["MESSAGE_SENT", "CALL"])
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  const ids = new Set<number>();

  for (const r of rows) {
    if (r.type === "MESSAGE_SENT") {
      ids.add(Number(r.prospect_id));
      continue;
    }

    try {
      const outcome = (JSON.parse(r.metadata ?? "{}") as { outcome?: string }).outcome;

      if (outcome && ANSWERED.includes(outcome)) ids.add(Number(r.prospect_id));
    } catch {
      // metadado ausente (ligação antiga): não conta
    }
  }

  return ids;
}
