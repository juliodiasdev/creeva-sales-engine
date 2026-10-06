import { getDatabase } from "./database";

export async function initDatabase(): Promise<void> {
  const db = await getDatabase();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      name TEXT NOT NULL,

      segment TEXT,
      city TEXT,
      state TEXT,

      website TEXT,
      phone TEXT,
      instagram TEXT,

      google_place_id TEXT,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS
    idx_companies_google_place_id
    ON companies(google_place_id)
    WHERE google_place_id IS NOT NULL
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS
    idx_companies_name
    ON companies(name)
  `);
}