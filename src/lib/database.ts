import Database from "@tauri-apps/plugin-sql";

export interface Company {
  id: number;
  name: string;
  segment: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  phone: string | null;
  instagram: string | null;
  google_place_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCompanyInput {
  name: string;
  segment?: string;
  city?: string;
  state?: string;
  website?: string;
  phone?: string;
  instagram?: string;
  googlePlaceId?: string;
}

let database: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (!database) {
    database = await Database.load("sqlite:creava.db");
  }

  return database;
}

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
}

export async function createCompany(
  input: CreateCompanyInput,
): Promise<void> {
  const db = await getDatabase();

  await db.execute(
    `
      INSERT INTO companies (
        name,
        segment,
        city,
        state,
        website,
        phone,
        instagram,
        google_place_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      )
    `,
    [
      input.name,
      input.segment ?? null,
      input.city ?? null,
      input.state ?? null,
      input.website ?? null,
      input.phone ?? null,
      input.instagram ?? null,
      input.googlePlaceId ?? null,
    ],
  );
}

export async function listCompanies(): Promise<Company[]> {
  const db = await getDatabase();

  return db.select<Company[]>(`
    SELECT
      id,
      name,
      segment,
      city,
      state,
      website,
      phone,
      instagram,
      google_place_id,
      created_at,
      updated_at

    FROM companies

    ORDER BY id DESC
  `);
}