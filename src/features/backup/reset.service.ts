import { getDatabase } from "../../lib/database";
import { ensurePlaybookSeed } from "../playbook/playbook.service";

const SECRET_KEYS_SQL = "'google_api_key','openai_api_key'";

// Ordem filho -> pai (respeita as foreign keys).
const BUSINESS_TABLES = [
  "proposals",
  "meetings",
  "deals",
  "activities",
  "tasks",
  "ai_analyses",
  "company_scores",
  "signals",
  "website_snapshots",
  "company_sources",
  "prospects",
  "companies",
  "jobs",
  "api_usage",
];

/** Remove somente as chaves de API (Google e OpenAI). */
export async function clearApiKeys(): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `DELETE FROM settings WHERE key IN (${SECRET_KEYS_SQL})`,
  );
}

/** Apaga empresas, prospects, tarefas, histórico, jobs e uso de APIs. */
export async function clearBusinessData(): Promise<void> {
  const db = await getDatabase();

  for (const table of BUSINESS_TABLES) {
    await db.execute(`DELETE FROM ${table}`);
  }

  await db.execute(
    `DELETE FROM sqlite_sequence WHERE name IN (${BUSINESS_TABLES.map(
      (t) => `'${t}'`,
    ).join(",")})`,
  );
}

/** Deixa o app como novo: dados, preferências, chaves e playbook padrão. */
export async function resetEverything(): Promise<void> {
  const db = await getDatabase();

  await clearBusinessData();

  await db.execute(`DELETE FROM settings`);
  await db.execute(`DELETE FROM playbook_scripts`);

  await ensurePlaybookSeed();
}
