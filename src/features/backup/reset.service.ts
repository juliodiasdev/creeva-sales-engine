import { getSupabase, unwrap } from "../../lib/store";
import { SECRET_SETTING_KEYS, TABLE_ORDER, pkOf } from "../../lib/tables";
import { ensurePlaybookSeed } from "../playbook/playbook.service";
import { ensureServicesSeed } from "../services/services.service";

// Configuração (playbook, serviços, settings) não é "dado de teste".
const CONFIG_TABLES = ["settings", "playbook_scripts", "services"];

const BUSINESS_TABLES = TABLE_ORDER.filter(
  (t) => !CONFIG_TABLES.includes(t),
);

/** PostgREST exige um filtro em DELETE: usamos um que casa com tudo. */
export async function deleteAllRows(table: string): Promise<void> {
  const supabase = getSupabase();
  const pk = pkOf(table);

  unwrap(
    pk === "id"
      ? await supabase.from(table).delete().gte("id", 0)
      : await supabase.from(table).delete().neq(pk, ""),
  );
}

export async function resetSequences(): Promise<void> {
  unwrap(await getSupabase().rpc("reset_identity_sequences"));
}

/** Remove somente as chaves de API (Google e OpenAI). */
export async function clearApiKeys(): Promise<void> {
  unwrap(
    await getSupabase()
      .from("settings")
      .delete()
      .in("key", SECRET_SETTING_KEYS),
  );
}

/** Apaga empresas, prospects, tarefas, histórico, jobs e uso de APIs. */
export async function clearBusinessData(): Promise<void> {
  // Filhos antes dos pais (a ordem inversa da inserção).
  for (const table of [...BUSINESS_TABLES].reverse()) {
    await deleteAllRows(table);
  }

  await resetSequences();
}

/** Deixa o app como novo: dados, preferências, chaves e playbook padrão. */
export async function resetEverything(): Promise<void> {
  await clearBusinessData();

  await deleteAllRows("settings");
  await deleteAllRows("playbook_scripts");
  await deleteAllRows("services");

  await ensurePlaybookSeed();
  await ensureServicesSeed();
  await resetSequences();
}
