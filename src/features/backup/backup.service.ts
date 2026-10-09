import { fetchAllPages, getSupabase, unwrap } from "../../lib/store";

import {
  SECRET_SETTING_KEYS,
  TABLE_COLUMNS,
  TABLE_ORDER,
  pkOf,
} from "../../lib/tables";

import { deleteAllRows, resetSequences } from "./reset.service";

export const BACKUP_FORMAT = "creava-sales-engine-backup";

/** Versão do formato. Backups de versões anteriores continuam válidos. */
export const BACKUP_SCHEMA_VERSION = 6;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Exporta tudo, exceto chaves de API (segredos ficam fora do backup). */
export async function exportBackup(): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};

  for (const table of TABLE_ORDER) {
    const order = pkOf(table);

    tables[table] = await fetchAllPages<Record<string, unknown>>(
      (from, to) =>
        getSupabase()
          .from(table)
          .select("*")
          .order(order, { ascending: true })
          .range(from, to) as never,
    );
  }

  tables.settings = tables.settings.filter(
    (row) => !SECRET_SETTING_KEYS.includes(String(row.key)),
  );

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/** Valida estrutura/versão antes de qualquer escrita. */
export function validateBackup(raw: unknown): BackupFile {
  const file = raw as Partial<BackupFile> | null;

  if (!file || file.format !== BACKUP_FORMAT) {
    throw new Error("Arquivo não é um backup deste aplicativo.");
  }

  if (
    typeof file.schemaVersion !== "number" ||
    file.schemaVersion > BACKUP_SCHEMA_VERSION
  ) {
    throw new Error(
      `Backup de schema v${file.schemaVersion} é mais novo que o app (v${BACKUP_SCHEMA_VERSION}).`,
    );
  }

  if (!file.tables || typeof file.tables !== "object") {
    throw new Error("Backup sem tabelas.");
  }

  for (const table of TABLE_ORDER) {
    const rows = file.tables[table];

    if (rows === undefined) continue;

    if (!Array.isArray(rows)) {
      throw new Error(`Tabela ${table} inválida no backup.`);
    }

    const allowed = new Set(TABLE_COLUMNS[table]);

    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!allowed.has(key)) {
          throw new Error(
            `Coluna desconhecida "${key}" na tabela ${table}.`,
          );
        }
      }
    }
  }

  return file as BackupFile;
}

const CHUNK = 500;

/**
 * Restaura o backup substituindo os dados atuais (chaves de API
 * existentes são preservadas). Tudo é validado ANTES de apagar.
 */
export async function importBackup(raw: unknown): Promise<void> {
  const file = validateBackup(raw);
  const supabase = getSupabase();

  for (const table of [...TABLE_ORDER].reverse()) {
    if (table === "settings") {
      unwrap(
        await supabase
          .from("settings")
          .delete()
          .not(
            "key",
            "in",
            `(${SECRET_SETTING_KEYS.map((k) => `"${k}"`).join(",")})`,
          ),
      );
    } else {
      await deleteAllRows(table);
    }
  }

  for (const table of TABLE_ORDER) {
    const rows = (file.tables[table] ?? []).filter(
      (row) =>
        !(
          table === "settings" &&
          SECRET_SETTING_KEYS.includes(String(row.key))
        ),
    );

    for (let i = 0; i < rows.length; i += CHUNK) {
      unwrap(await supabase.from(table).insert(rows.slice(i, i + CHUNK)));
    }
  }

  await resetSequences();
}
