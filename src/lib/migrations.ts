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
  await db.execute(`
  PRAGMA foreign_keys = ON
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    company_id INTEGER NOT NULL UNIQUE,

    status TEXT NOT NULL DEFAULT 'READY',

    priority TEXT NOT NULL DEFAULT 'NORMAL',

    score INTEGER NOT NULL DEFAULT 0,

    next_action TEXT,
    next_action_at DATETIME,

    qualification_notes TEXT,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (company_id)
      REFERENCES companies(id)
      ON DELETE CASCADE
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    prospect_id INTEGER NOT NULL,

    type TEXT NOT NULL,

    title TEXT NOT NULL,
    description TEXT,

    priority TEXT NOT NULL DEFAULT 'NORMAL',

    due_at DATETIME,
    completed_at DATETIME,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (prospect_id)
      REFERENCES prospects(id)
      ON DELETE CASCADE
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    prospect_id INTEGER NOT NULL,

    type TEXT NOT NULL,

    channel TEXT,

    content TEXT,

    metadata TEXT,

    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (prospect_id)
      REFERENCES prospects(id)
      ON DELETE CASCADE
  )
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS
  idx_prospects_status
  ON prospects(status)
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS
  idx_tasks_due_at
  ON tasks(due_at)
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS
  idx_tasks_prospect_id
  ON tasks(prospect_id)
`);

await db.execute(`
  CREATE INDEX IF NOT EXISTS
  idx_activities_prospect_id
  ON activities(prospect_id)
`);
}