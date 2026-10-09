import { getSupabase } from "./supabase";
import { ensurePlaybookSeed } from "../features/playbook/playbook.service";
import { runRepairsOnce } from "../features/maintenance/repair.service";
import { ensureServicesSeed } from "../features/services/services.service";

/** Verifica se o schema existe e prepara dados iniciais. */
export async function initApp(): Promise<void> {
  // "lists" e "companies.list_id" existem só a partir do schema v3 (listas):
  // servem de marcador de versão do banco.
  const supabase = getSupabase();
  const first = await supabase.from("lists").select("id").limit(1);
  const { error } = first.error
    ? first
    : await supabase.from("companies").select("id,list_id").limit(1);

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

  // Corrige dados de versões anteriores (uma vez só). Não bloqueia o app.
  await runRepairsOnce().catch((err) => console.error("reparos", err));
}
