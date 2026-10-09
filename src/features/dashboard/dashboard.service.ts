import { fetchAllPages, getSupabase } from "../../lib/store";

export interface DashboardMetrics {
  companiesDiscovered: number;
  companiesEnriched: number;
  companiesQualified: number;
  companiesDiscarded: number;
  prospects: number;
  contactsSent: number;
  replies: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  replyRate: number;
  meetingRate: number;
  closeRate: number;
  pipelineValue: number;
  revenue: number;
  averageTicket: number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Somente dados reais, calculados do banco. */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = getSupabase();

  const count = async (table: string): Promise<number> => {
    const { count: n, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true });

    if (error) throw new Error(error.message);

    return n ?? 0;
  };

  const countWhere = async (
    table: string,
    column: string,
    values: string[],
  ): Promise<number> => {
    const { count: n, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .in(column, values);

    if (error) throw new Error(error.message);

    return n ?? 0;
  };

  const distinctProspects = async (type: string): Promise<number> => {
    const rows = await fetchAllPages<{ prospect_id: number }>(
      (from, to) =>
        supabase
          .from("activities")
          .select("prospect_id")
          .eq("type", type)
          .range(from, to) as never,
    );

    return new Set(rows.map((r) => Number(r.prospect_id))).size;
  };

  const deals = await fetchAllPages<{ status: string; value: number }>(
    (from, to) =>
      supabase
        .from("deals")
        .select("status,value")
        .range(from, to) as never,
  );

  const sum = (status: string) =>
    deals
      .filter((d) => d.status === status)
      .reduce((total, d) => total + Number(d.value), 0);

  const [
    companiesDiscovered,
    companiesEnriched,
    companiesQualified,
    companiesDiscarded,
    prospects,
    contactsSent,
    replies,
    meetings,
    proposals,
    lost,
  ] = await Promise.all([
    count("companies"),
    countWhere("companies", "lead_status", ["ENRICHED", "QUALIFIED", "READY"]),
    countWhere("companies", "lead_status", ["QUALIFIED", "READY"]),
    countWhere("companies", "lead_status", ["DISQUALIFIED"]),
    count("prospects"),
    distinctProspects("MESSAGE_SENT"),
    distinctProspects("REPLY_RECEIVED"),
    distinctProspects("MEETING"),
    distinctProspects("PROPOSAL_SENT"),
    countWhere("prospects", "status", ["LOST"]),
  ]);

  const won = deals.filter((d) => d.status === "WON").length;
  const revenue = sum("WON");

  return {
    companiesDiscovered,
    companiesEnriched,
    companiesQualified,
    companiesDiscarded,
    prospects,
    contactsSent,
    replies,
    meetings,
    proposals,
    won,
    lost,
    replyRate: ratio(replies, contactsSent),
    meetingRate: ratio(meetings, contactsSent),
    closeRate: ratio(won, won + lost),
    pipelineValue: sum("OPEN"),
    revenue,
    averageTicket: ratio(revenue, won),
  };
}
