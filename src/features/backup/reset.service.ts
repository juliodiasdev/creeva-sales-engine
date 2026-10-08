import { getSupabase, unwrap } from "../../lib/store";
import { SECRET_SETTING_KEYS, TABLE_ORDER } from "../../lib/tables";
import { ensurePlaybookSeed } from "../playbook/playbook.service";

const BUSINESS_TABLES = TABLE_ORDER.filter(
  (t) => t !== "settings" && t !== "playbook_scripts",
);

/** PostgREST exige um filtro em DELETE; todas as tabelas têm id >= 1. */
export async function deleteAllRows(table: string): Promise<void> {
  const supabase = getSupabase();

  unwrap(
    table === "settings"
      ? await supabase.from(table).delete().neq("key", "")
      : await supabase.from(table).delete().gte("id", 0),
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

  await ensurePlaybookSeed();
  await resetSequences();
}
