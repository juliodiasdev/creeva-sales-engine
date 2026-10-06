import { getDatabase } from "../../lib/database";

export async function recordApiUsage(input: {
  provider: "GOOGLE_PLACES" | "OPENAI" | "CNPJ" | "WEBSITE";
  operation: string;
  requests?: number;
  tokens?: number;
  estimatedCost?: number;
}): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO api_usage (provider, operation, requests, tokens, estimated_cost)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      input.provider,
      input.operation,
      input.requests ?? 1,
      input.tokens ?? 0,
      input.estimatedCost ?? 0,
    ],
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
  const db = await getDatabase();

  return db.select(
    `
      SELECT provider,
             SUM(requests) AS requests,
             SUM(tokens) AS tokens,
             SUM(estimated_cost) AS estimated_cost
      FROM api_usage
      GROUP BY provider
    `,
  );
}
