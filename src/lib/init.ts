import { getSupabase } from "./supabase";
import { ensurePlaybookSeed } from "../features/playbook/playbook.service";

/** Verifica se o schema existe e prepara dados iniciais. */
export async function initApp(): Promise<void> {
  const { error } = await getSupabase()
    .from("settings")
    .select("key")
    .limit(1);

  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message);

    throw new Error(
      missing
        ? "O banco ainda não foi preparado: execute o arquivo supabase/schema.sql no SQL Editor do Supabase."
        : error.message,
    );
  }

  await ensurePlaybookSeed();
}
