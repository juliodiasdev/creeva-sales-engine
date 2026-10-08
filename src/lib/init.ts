import { getSupabase } from "./supabase";
import { ensurePlaybookSeed } from "../features/playbook/playbook.service";
import { ensureServicesSeed } from "../features/services/services.service";

/** Verifica se o schema existe e prepara dados iniciais. */
export async function initApp(): Promise<void> {
  // "services" existe só a partir do schema v2: serve de marcador de versão.
  const { error } = await getSupabase()
    .from("services")
    .select("id")
    .limit(1);

  if (error) {
    const missing =
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message);

    throw new Error(
      missing
        ? "O banco precisa ser criado/atualizado: execute o arquivo supabase/schema.sql no SQL Editor do Supabase (pode rodar de novo, é seguro)."
        : error.message,
    );
  }

  await ensurePlaybookSeed();
  await ensureServicesSeed();
}
