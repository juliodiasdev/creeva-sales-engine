import Database from "@tauri-apps/plugin-sql";

/** Subconjunto da API do plugin usado pelos repositories (permite testes). */
export interface Db {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{
    rowsAffected: number;
    lastInsertId?: number;
  }>;

  select<T>(
    sql: string,
    params?: unknown[],
  ): Promise<T>;
}

let database: Db | null = null;

export async function getDatabase(): Promise<Db> {
  if (!database) {
    const db = await Database.load("sqlite:creava.db");

    // O pool pode ter várias conexões; PRAGMA vale por conexão.
    await db.execute("PRAGMA foreign_keys = ON");

    database = db;
  }

  return database;
}
