import { DatabaseSync } from "node:sqlite";

import { runMigrations } from "../lib/migrations";
import type { Db } from "../lib/database";

/** Banco SQLite em memória com a mesma interface do plugin Tauri. */
export function createTestDb(): Db {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  // O plugin usa $1,$2...; o node:sqlite aceita ?1,?2...
  const convert = (sql: string) =>
    sql.replace(/\$(\d+)/g, "?$1");

  const bind = (params: unknown[] = []) =>
    params.map((p) => (p === undefined ? null : p)) as never[];

  return {
    async execute(sql, params) {
      const result = sqlite
        .prepare(convert(sql))
        .run(...bind(params));

      return {
        rowsAffected: Number(result.changes),
        lastInsertId: Number(result.lastInsertRowid),
      };
    },

    async select<T>(sql: string, params?: unknown[]) {
      return sqlite
        .prepare(convert(sql))
        .all(...bind(params)) as T;
    },
  };
}

export async function createMigratedTestDb(): Promise<Db> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}
