import { getSupabase } from "./supabase";
import { ensurePlaybookSeed } from "../features/playbook/playbook.service";
import { runRepairsOnce } from "../features/maintenance/repair.service";
import { ensureServicesSeed } from "../features/services/services.service";

/** Verifica se o schema existe e prepara dados iniciais. */
export async function initApp(): Promise<void> {
  // Marcadores da versão do banco: tabelas/colunas criadas pelo schema mais novo
  // (listas, conversas, supressão e gargalos). Se faltar algo, orienta a rodar o schema.
  const supabase = getSupabase();
  const probes = [
    () => supabase.from("lists").select("id").limit(1),
    () => supabase.from("companies").select("id,list_id").limit(1),
    () => supabase.from("conversations").select("id").limit(1),
    () => supabase.from("suppressions").select("id").limit(1),
    () => supabase.from("ai_analyses").select("id,bottlenecks").limit(1),
  ];

  let error: { code?: string; message: string } | null = null;

  for (const probe of probes) {
    const result = await probe();

    if (result.error) {
      error = result.error;
      break;
    }
  }

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
