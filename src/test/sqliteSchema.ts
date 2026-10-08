import type { Db } from "./dbTypes";

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
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prospect_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        channel TEXT,
        content TEXT,
        metadata TEXT,
        occurred_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_id INTEGER NOT NULL,
        prospect_id INTEGER NOT NULL,
        value REAL NOT NULL,
        description TEXT,
        sent_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        valid_until DATETIME,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
        FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
      )`,
    ],
  },
  {
    version: 3,
    name: "enrichment_and_platform",
    statements: [
      `ALTER TABLE companies ADD COLUMN cnpj TEXT`,
      `ALTER TABLE companies ADD COLUMN legal_name TEXT`,
      `ALTER TABLE companies ADD COLUMN cnae TEXT`,
      `ALTER TABLE companies ADD COLUMN company_size TEXT`,
      `ALTER TABLE companies ADD COLUMN registration_status TEXT`,
      `ALTER TABLE companies ADD COLUMN opened_at TEXT`,
      `ALTER TABLE companies ADD COLUMN capital REAL`,
      `ALTER TABLE companies ADD COLUMN address TEXT`,
      `ALTER TABLE companies ADD COLUMN category TEXT`,
      `ALTER TABLE companies ADD COLUMN rating REAL`,
      `ALTER TABLE companies ADD COLUMN reviews_count INTEGER`,
      `ALTER TABLE companies ADD COLUMN domain TEXT`,
      `ALTER TABLE companies ADD COLUMN phone_normalized TEXT`,
      `ALTER TABLE companies ADD COLUMN dedupe_key TEXT`,
      `ALTER TABLE companies ADD COLUMN lead_status TEXT NOT NULL DEFAULT 'DISCOVERED'`,
      `ALTER TABLE companies ADD COLUMN disqualified_reason TEXT`,
      `CREATE INDEX idx_companies_cnpj ON companies(cnpj)`,
      `CREATE INDEX idx_companies_domain ON companies(domain)`,
      `CREATE INDEX idx_companies_phone ON companies(phone_normalized)`,
      `CREATE INDEX idx_companies_dedupe_key ON companies(dedupe_key)`,
      `CREATE INDEX idx_companies_lead_status ON companies(lead_status)`,
      `CREATE TABLE company_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT,
        raw_data TEXT,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_company_sources_company ON company_sources(company_id)`,
      `CREATE TABLE website_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        facts TEXT NOT NULL,
        fetched_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_snapshots_company ON website_snapshots(company_id)`,
      `CREATE TABLE signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        value TEXT,
        evidence TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_signals_company ON signals(company_id)`,
      `CREATE TABLE company_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        fit INTEGER NOT NULL,
        need INTEGER NOT NULL,
        capacity INTEGER NOT NULL,
        intent INTEGER NOT NULL,
        total INTEGER NOT NULL,
        confidence REAL NOT NULL,
        reasons TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_scores_company ON company_scores(company_id)`,
      `CREATE TABLE ai_analyses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        summary TEXT NOT NULL,
        main_problem TEXT NOT NULL,
        opportunity TEXT NOT NULL,
        recommended_offer TEXT NOT NULL,
        outreach_angle TEXT NOT NULL,
        confidence REAL NOT NULL,
        model TEXT,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX idx_ai_company ON ai_analyses(company_id)`,
      `CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        progress INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        result TEXT,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        started_at DATETIME,
        finished_at DATETIME
      )`,
      `CREATE TABLE api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        operation TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 1,
        tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      `CREATE TABLE playbook_scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        segment TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
    ],
  },
  {
    version: 4,
    name: "services_channels_approaches",
    statements: [
      `ALTER TABLE ai_analyses ADD COLUMN recommended_services TEXT`,
      `CREATE TABLE services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        pain_points TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      `CREATE TABLE company_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        url TEXT,
        label TEXT,
        source TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (company_id, kind, value),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE company_approaches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        service_key TEXT,
        angle TEXT NOT NULL,
        message TEXT NOT NULL,
        evidence_used TEXT,
        source TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE seen_places (
        google_place_id TEXT PRIMARY KEY,
        company_id INTEGER,
        times_seen INTEGER NOT NULL DEFAULT 1,
        first_seen_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_seen_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE discovery_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_key TEXT NOT NULL UNIQUE,
        segment TEXT NOT NULL,
        city TEXT NOT NULL,
        neighborhood TEXT,
        pages INTEGER NOT NULL DEFAULT 1,
        runs INTEGER NOT NULL DEFAULT 1,
        last_found INTEGER NOT NULL DEFAULT 0,
        last_imported INTEGER NOT NULL DEFAULT 0,
        last_run_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
      applied_at DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
      try {
        await db.execute(statement);
      } catch (err) {
        // Reexecução após falha parcial: o objeto já existe.
        const text = String(
          err instanceof Error ? err.message : err,
        );

        if (!/duplicate column name|already exists/i.test(text)) {
          throw new Error(
            `Migration ${migration.version} (${migration.name}) falhou: ${text}\nSQL: ${statement.slice(0, 120)}`,
          );
        }
      }
    }

    // Registrada por último: se algo falhar no meio, a migration
    // é reexecutada (por isso as ALTER vêm antes de qualquer dado).
    await db.execute(
      `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
      [migration.version, migration.name],
    );
  }
}
