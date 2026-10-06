import { getDatabase } from "./database";
import type { Db } from "./database";

interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/**
 * Migrations versionadas. Cada uma roda uma única vez
 * (registrada em schema_migrations). NUNCA edite uma migration
 * já publicada: crie uma nova.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "baseline",
    statements: [
      `CREATE TABLE IF NOT EXISTS companies (
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
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_google_place_id
        ON companies(google_place_id) WHERE google_place_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name)`,
      `CREATE TABLE IF NOT EXISTS prospects (
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
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prospect_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        due_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prospect_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        channel TEXT,
        content TEXT,
        metadata TEXT,
        occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at)`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_prospect_id ON tasks(prospect_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_prospect_id ON activities(prospect_id)`,
    ],
  },
  {
    version: 2,
    name: "sales_cycle",
    statements: [
      `ALTER TABLE tasks ADD COLUMN outcome TEXT`,
      `ALTER TABLE prospects ADD COLUMN lost_reason TEXT`,
      `ALTER TABLE prospects ADD COLUMN closed_at DATETIME`,
      `CREATE TABLE deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prospect_id INTEGER NOT NULL,
        service_type TEXT,
        title TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        probability INTEGER NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'OPEN',
        expected_close_at DATETIME,
        closed_at DATETIME,
        recurring INTEGER NOT NULL DEFAULT 0,
        lost_reason TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_deals_prospect_id ON deals(prospect_id)`,
      `CREATE INDEX idx_deals_status ON deals(status)`,
      `CREATE TABLE meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prospect_id INTEGER NOT NULL,
        scheduled_at DATETIME NOT NULL,
        notes TEXT,
        need TEXT,
        budget TEXT,
        decision_maker TEXT,
        timeline TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_id INTEGER NOT NULL,
        prospect_id INTEGER NOT NULL,
        value REAL NOT NULL,
        description TEXT,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        valid_until DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
    ],
  },
];

export async function runMigrations(
  db: Db,
  migrations: Migration[] = MIGRATIONS,
): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  const applied = new Set(
    (
      await db.select<{ version: number }[]>(
        `SELECT version FROM schema_migrations`,
      )
    ).map((row) => row.version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    for (const statement of migration.statements) {
      await db.execute(statement);
    }

    // Registrada por último: se algo falhar no meio, a migration
    // é reexecutada (por isso as ALTER vêm antes de qualquer dado).
    await db.execute(
      `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
      [migration.version, migration.name],
    );
  }
}

export async function initDatabase(): Promise<void> {
  await runMigrations(await getDatabase());
}
