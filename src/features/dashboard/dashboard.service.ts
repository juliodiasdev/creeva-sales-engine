import { getDatabase } from "../../lib/database";

export interface DashboardMetrics {
  companiesDiscovered: number;
  companiesQualified: number;
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

/** Somente dados reais, calculados do SQLite. */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = await getDatabase();

  const one = async (sql: string): Promise<number> => {
    const rows = await db.select<{ n: number | null }[]>(sql);
    return Number(rows[0]?.n ?? 0);
  };

  const distinct = (type: string) =>
    one(
      `SELECT COUNT(DISTINCT prospect_id) AS n FROM activities WHERE type = '${type}'`,
    );

  const [
    companiesDiscovered,
    companiesQualified,
    prospects,
    contactsSent,
    replies,
    meetings,
    proposals,
    won,
    lost,
    pipelineValue,
    revenue,
  ] = await Promise.all([
    one(`SELECT COUNT(*) AS n FROM companies`),
    one(`SELECT COUNT(*) AS n FROM companies WHERE lead_status IN ('QUALIFIED','READY')`),
    one(`SELECT COUNT(*) AS n FROM prospects`),
    distinct("MESSAGE_SENT"),
    distinct("REPLY_RECEIVED"),
    distinct("MEETING"),
    distinct("PROPOSAL_SENT"),
    one(`SELECT COUNT(*) AS n FROM deals WHERE status = 'WON'`),
    one(`SELECT COUNT(*) AS n FROM prospects WHERE status = 'LOST'`),
    one(`SELECT SUM(value) AS n FROM deals WHERE status = 'OPEN'`),
    one(`SELECT SUM(value) AS n FROM deals WHERE status = 'WON'`),
  ]);

  return {
    companiesDiscovered,
    companiesQualified,
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
    pipelineValue,
    revenue,
    averageTicket: ratio(revenue, won),
  };
}
