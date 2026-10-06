import { getDatabase } from "../../lib/database";

export const SECRET_KEYS = [
  "google_api_key",
  "openai_api_key",
] as const;

export type SettingKey =
  | (typeof SECRET_KEYS)[number]
  | "default_city"
  | "default_state"
  | "preferred_segments"
  | "min_score"
  | "follow_up_delay_days"
  | "proposal_follow_up_days"
  | "seller_name"
  | "company_name"
  | "openai_model";

export const DEFAULTS: Partial<Record<SettingKey, string>> = {
  follow_up_delay_days: "2",
  proposal_follow_up_days: "3",
  min_score: "50",
  company_name: "Creava Digital",
  openai_model: "gpt-4o-mini",
};

export function isSecret(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export async function getSetting(
  key: SettingKey,
): Promise<string | null> {
  const db = await getDatabase();

  const rows = await db.select<{ value: string }[]>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );

  return rows[0]?.value ?? DEFAULTS[key] ?? null;
}

export async function getNumberSetting(
  key: SettingKey,
  fallback: number,
): Promise<number> {
  const value = Number(await getSetting(key));

  return Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export async function setSetting(
  key: SettingKey,
  value: string,
): Promise<void> {
  const db = await getDatabase();

  const trimmed = value.trim();

  if (!trimmed) {
    await db.execute(`DELETE FROM settings WHERE key = $1`, [key]);
    return;
  }

  await db.execute(
    `
      INSERT INTO settings (key, value) VALUES ($1, $2)
      ON CONFLICT(key) DO UPDATE
      SET value = excluded.value, updated_at = datetime('now')
    `,
    [key, trimmed],
  );
}

/**
 * Valores para a UI: segredos nunca saem do banco,
 * só informamos se estão configurados.
 */
export async function getPublicSettings(): Promise<{
  values: Record<string, string>;
  configured: Record<string, boolean>;
}> {
  const db = await getDatabase();

  const rows = await db.select<
    { key: string; value: string }[]
  >(`SELECT key, value FROM settings`);

  const values: Record<string, string> = {};
  const configured: Record<string, boolean> = {};

  for (const row of rows) {
    if (isSecret(row.key)) configured[row.key] = true;
    else values[row.key] = row.value;
  }

  return { values, configured };
}
