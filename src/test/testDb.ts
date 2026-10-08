import { DatabaseSync } from "node:sqlite";

import { runMigrations } from "./sqliteSchema";
import { createFakeSupabase } from "./fakeSupabase";
import type { Db } from "./dbTypes";

/** Cliente fake do Supabase da base de teste atual (usado nos vi.mock). */
let currentClient: ReturnType<typeof createFakeSupabase> | null = null;

export function testClient() {
  if (!currentClient) throw new Error("banco de teste não criado");
  return currentClient;
}

/** SQLite em memória + cliente fake; `db` serve para asserções em SQL. */
export function createTestDb(): Db {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");

  currentClient = createFakeSupabase(sqlite);

  const convert = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");

  const bind = (params: unknown[] = []) =>
    params.map((p) => (p === undefined ? null : p)) as never[];

  return {
    async execute(sql, params) {
      const result = sqlite.prepare(convert(sql)).run(...bind(params));

      return {
        rowsAffected: Number(result.changes),
        lastInsertId: Number(result.lastInsertRowid),
      };
    },

    async select<T>(sql: string, params?: unknown[]) {
      return sqlite.prepare(convert(sql)).all(...bind(params)) as T;
    },
  };
}

export async function createMigratedTestDb(): Promise<Db> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}
