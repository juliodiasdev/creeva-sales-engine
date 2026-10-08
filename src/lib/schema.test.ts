import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DatabaseSync } from "node:sqlite";

import { TABLE_COLUMNS } from "./tables";
import { MIGRATIONS } from "../test/sqliteSchema";

/** Garante que schema.sql (nuvem), tables.ts e o schema de teste não divergem. */
describe("schema consistency", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");

  const cloud: Record<string, string[]> = {};

  for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    cloud[m[1]] = m[2]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z_]+ /.test(l) && !/^(primary|foreign|unique|constraint)/.test(l))
      .map((l) => l.split(" ")[0]);
  }

  it("tables.ts matches supabase/schema.sql", () => {
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      expect(cloud[table], `tabela ${table}`).toBeDefined();
      expect([...cloud[table]].sort(), table).toEqual([...columns].sort());
    }

    expect(Object.keys(cloud).sort()).toEqual(Object.keys(TABLE_COLUMNS).sort());
  });

  it("test sqlite schema matches tables.ts", () => {
    const db = new DatabaseSync(":memory:");

    for (const m of MIGRATIONS) for (const st of m.statements) db.exec(st);

    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const actual = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(actual.sort(), table).toEqual([...columns].sort());
    }
  });
});
