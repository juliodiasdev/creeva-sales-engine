import { getSupabase, nowIso, unwrap } from "../../lib/store";

export const SECRET_KEYS = [
  "google_api_key",
  "openai_api_key",
  "anthropic_api_key",
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
  | "openai_model"
  | "anthropic_model"
  | "data_repairs";

export const DEFAULTS: Partial<Record<SettingKey, string>> = {
  follow_up_delay_days: "2",
  proposal_follow_up_days: "3",
  min_score: "50",
  company_name: "Creava Digital",
  openai_model: "gpt-4o-mini",
  anthropic_model: "claude-sonnet-5-5",
};

export function isSecret(key: string): boolean {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

export async function getSetting(
  key: SettingKey,
): Promise<string | null> {
  const row = unwrap(
    await getSupabase()
      .from("settings")
      .select("value")
      .eq("key", key)
      .maybeSingle(),
  ) as { value: string } | null;

  return row?.value ?? DEFAULTS[key] ?? null;
}

export async function getNumberSetting(
  key: SettingKey,
  fallback: number,
): Promise<number> {
  const value = Number(await getSetting(key));

  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function setSetting(
  key: SettingKey,
  value: string,
): Promise<void> {
  const supabase = getSupabase();
  const trimmed = value.trim();

  if (!trimmed) {
    unwrap(await supabase.from("settings").delete().eq("key", key));
    return;
  }

  unwrap(
    await supabase
      .from("settings")
      .upsert(
        { key, value: trimmed, updated_at: nowIso() },
        { onConflict: "key" },
      ),
  );
}

/**
 * Valores para a UI: segredos nunca são exibidos,
 * só informamos se estão configurados.
 */
export async function getPublicSettings(): Promise<{
  values: Record<string, string>;
  configured: Record<string, boolean>;
}> {
  const rows = unwrap(
    await getSupabase().from("settings").select("key,value"),
  ) as { key: string; value: string }[];

  const values: Record<string, string> = {};
  const configured: Record<string, boolean> = {};

  for (const row of rows) {
    if (isSecret(row.key)) configured[row.key] = true;
    else values[row.key] = row.value;
  }

  return { values, configured };
}
