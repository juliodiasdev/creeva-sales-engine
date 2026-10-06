import { getDatabase } from "../../lib/database";
import { SECRET_KEYS } from "../settings/settings.service";

export const BACKUP_FORMAT = "creava-sales-engine-backup";

// Ordem de inserção respeita as FKs; a remoção usa a ordem inversa.
const TABLES = [
  "companies",
  "company_sources",
  "website_snapshots",
  "signals",
  "company_scores",
  "ai_analyses",
  "prospects",
  "tasks",
  "activities",
  "deals",
  "meetings",
  "proposals",
  "playbook_scripts",
  "settings",
  "jobs",
  "api_usage",
] as const;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

async function currentSchemaVersion(): Promise<number> {
  const db = await getDatabase();

  const rows = await db.select<{ v: number | null }[]>(
    `SELECT MAX(version) AS v FROM schema_migrations`,
  );

  return rows[0]?.v ?? 0;
}

/** Exporta tudo, exceto chaves de API (segredos ficam fora do backup). */
export async function exportBackup(): Promise<BackupFile> {
  const db = await getDatabase();

  const tables: BackupFile["tables"] = {};

  for (const table of TABLES) {
    tables[table] = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM ${table}`,
    );
  }

  tables.settings = tables.settings.filter(
    (row) => !(SECRET_KEYS as readonly string[]).includes(String(row.key)),
  );

  return {
    format: BACKUP_FORMAT,
    schemaVersion: await currentSchemaVersion(),
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/** Valida estrutura/versão antes de qualquer escrita. */
export async function validateBackup(raw: unknown): Promise<BackupFile> {
  const file = raw as Partial<BackupFile> | null;

  if (!file || file.format !== BACKUP_FORMAT) {
    throw new Error("Arquivo não é um backup do Creava Sales Engine.");
  }

  const current = await currentSchemaVersion();

  if (
    typeof file.schemaVersion !== "number" ||
    file.schemaVersion > current
  ) {
    throw new Error(
      `Backup de schema v${file.schemaVersion} é mais novo que o app (v${current}).`,
    );
  }

  if (!file.tables || typeof file.tables !== "object") {
    throw new Error("Backup sem tabelas.");
  }

  const db = await getDatabase();

  for (const table of TABLES) {
    const rows = file.tables[table];

    if (rows === undefined) continue;

    if (!Array.isArray(rows)) {
      throw new Error(`Tabela ${table} inválida no backup.`);
    }

    const columns = new Set(
      (
        await db.select<{ name: string }[]>(
          `PRAGMA table_info(${table})`,
        )
      ).map((c) => c.name),
    );

    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.has(key)) {
          throw new Error(
            `Coluna desconhecida "${key}" na tabela ${table}.`,
          );
        }
      }
    }
  }

  return file as BackupFile;
}

/**
 * Restaura o backup substituindo os dados atuais (chaves de API
 * existentes são preservadas). Tudo é validado ANTES de apagar.
 */
export async function importBackup(raw: unknown): Promise<void> {
  const file = await validateBackup(raw);

  const db = await getDatabase();

  for (const table of [...TABLES].reverse()) {
    if (table === "settings") {
      await db.execute(
        `DELETE FROM settings WHERE key NOT IN ('google_api_key','openai_api_key')`,
      );
    } else {
      await db.execute(`DELETE FROM ${table}`);
    }
  }

  for (const table of TABLES) {
    for (const row of file.tables[table] ?? []) {
      const columns = Object.keys(row);

      if (columns.length === 0) continue;

      await db.execute(
        `INSERT OR REPLACE INTO ${table} (${columns.join(",")}) VALUES (${columns
          .map((_, i) => `$${i + 1}`)
          .join(",")})`,
        columns.map((c) => row[c]),
      );
    }
  }
}
