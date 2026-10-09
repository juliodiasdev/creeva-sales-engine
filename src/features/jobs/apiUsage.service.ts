import { fetchAllPages, getSupabase, unwrap } from "../../lib/store";

export async function recordApiUsage(input: {
  provider: "GOOGLE_PLACES" | "OPENAI" | "ANTHROPIC" | "CNPJ" | "WEBSITE";
  operation: string;
  requests?: number;
  tokens?: number;
  estimatedCost?: number;
}): Promise<void> {
  unwrap(
    await getSupabase()
      .from("api_usage")
      .insert({
        provider: input.provider,
        operation: input.operation,
        requests: input.requests ?? 1,
        tokens: input.tokens ?? 0,
        estimated_cost: input.estimatedCost ?? 0,
      }),
  );
}

export async function getApiUsageSummary(): Promise<
  {
    provider: string;
    requests: number;
    tokens: number;
    estimated_cost: number;
  }[]
> {
  const rows = await fetchAllPages<{
    provider: string;
    requests: number;
    tokens: number;
    estimated_cost: number;
  }>((from, to) =>
    getSupabase()
      .from("api_usage")
      .select("provider,requests,tokens,estimated_cost")
      .range(from, to) as never,
  );

  const totals = new Map<
    string,
    { provider: string; requests: number; tokens: number; estimated_cost: number }
  >();

  for (const row of rows) {
    const t = totals.get(row.provider) ?? {
      provider: row.provider,
      requests: 0,
      tokens: 0,
      estimated_cost: 0,
    };

    t.requests += Number(row.requests);
    t.tokens += Number(row.tokens);
    t.estimated_cost += Number(row.estimated_cost);
    totals.set(row.provider, t);
  }

  return [...totals.values()];
}
