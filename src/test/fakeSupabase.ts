import { DatabaseSync } from "node:sqlite";

/**
 * Emulação mínima do supabase-js (PostgREST) sobre node:sqlite, só com
 * o que os repositories usam: select/insert/update/delete/upsert, filtros
 * eq/neq/in/is/lt/lte/gt/gte/not/or, order, limit, range, single,
 * maybeSingle e count/head. Permite testar a regra de negócio sem rede.
 */

interface Filter {
  sql: string;
  params: unknown[];
}

type Op = "select" | "insert" | "update" | "delete" | "upsert";

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`identificador inválido: ${name}`);
  }
  return `"${name}"`;
};

const norm = (v: unknown) =>
  v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v;

function condition(col: string, op: string, value: unknown): Filter {
  const c = ident(col);

  switch (op) {
    case "eq": return { sql: `${c} = ?`, params: [norm(value)] };
    case "neq": return { sql: `${c} <> ?`, params: [norm(value)] };
    case "lt": return { sql: `${c} < ?`, params: [norm(value)] };
    case "lte": return { sql: `${c} <= ?`, params: [norm(value)] };
    case "gt": return { sql: `${c} > ?`, params: [norm(value)] };
    case "gte": return { sql: `${c} >= ?`, params: [norm(value)] };
    case "is":
      return value === null
        ? { sql: `${c} IS NULL`, params: [] }
        : { sql: `${c} IS ?`, params: [norm(value)] };
    case "in": {
      const list = typeof value === "string"
        ? value.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
        : (value as unknown[]);
      return list.length === 0
        ? { sql: "0", params: [] }
        : { sql: `${c} IN (${list.map(() => "?").join(",")})`, params: list.map(norm) };
    }
    default:
      throw new Error(`operador não suportado: ${op}`);
  }
}

function parseOr(expr: string): Filter {
  const parts = expr.split(",").map((part) => {
    const [col, op, ...rest] = part.split(".");
    const raw = rest.join(".");
    return condition(col, op, raw === "null" ? null : raw);
  });

  return {
    sql: `(${parts.map((p) => p.sql).join(" OR ")})`,
    params: parts.flatMap((p) => p.params),
  };
}

class Query implements PromiseLike<unknown> {
  private op: Op = "select";
  private columns = "*";
  private payload: Record<string, unknown>[] = [];
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private offsetN = 0;
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private countHead = false;
  private wantCount = false;
  private conflict: string | null = null;
  private ignoreDup = false;

  constructor(
    private db: DatabaseSync,
    private table: string,
  ) {}

  select(columns = "*", opts?: { count?: string; head?: boolean }) {
    if (columns.includes("(")) throw new Error("embedding não suportado no fake");
    this.columns = columns;
    this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.countHead = true;
    return this;
  }

  insert(rows: object | object[]) {
    this.op = "insert";
    this.payload = ([] as object[]).concat(rows) as Record<string, unknown>[];
    return this;
  }

  upsert(
    rows: object | object[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.op = "upsert";
    this.conflict = opts?.onConflict ?? null;
    this.ignoreDup = !!opts?.ignoreDuplicates;
    this.payload = ([] as object[]).concat(rows) as Record<string, unknown>[];
    return this;
  }

  update(values: object) {
    this.op = "update";
    this.payload = [values as Record<string, unknown>];
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  private add(col: string, op: string, v: unknown) {
    this.filters.push(condition(col, op, v));
    return this;
  }

  eq(c: string, v: unknown) { return this.add(c, "eq", v); }
  neq(c: string, v: unknown) { return this.add(c, "neq", v); }
  lt(c: string, v: unknown) { return this.add(c, "lt", v); }
  lte(c: string, v: unknown) { return this.add(c, "lte", v); }
  gt(c: string, v: unknown) { return this.add(c, "gt", v); }
  gte(c: string, v: unknown) { return this.add(c, "gte", v); }
  in(c: string, v: unknown[]) { return this.add(c, "in", v); }
  is(c: string, v: unknown) { return this.add(c, "is", v); }

  ilike(c: string, pattern: string) {
    this.filters.push({ sql: `LOWER(${ident(c)}) LIKE LOWER(?)`, params: [pattern] });
    return this;
  }

  not(c: string, op: string, v: unknown) {
    const f = condition(c, op, v);
    this.filters.push({ sql: `NOT (${f.sql})`, params: f.params });
    return this;
  }

  or(expr: string) {
    this.filters.push(parseOr(expr));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push(`${ident(col)} ${opts?.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }

  limit(n: number) { this.limitN = n; return this; }

  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }

  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private where() {
    return this.filters.length
      ? ` WHERE ${this.filters.map((f) => f.sql).join(" AND ")}`
      : "";
  }

  private whereParams() {
    return this.filters.flatMap((f) => f.params);
  }

  private run(): { data: unknown; error: { message: string; code?: string } | null; count?: number } {
    try {
      const t = ident(this.table);
      let rows: unknown[] = [];
      let count: number | undefined;

      if (this.op === "select") {
        if (this.wantCount) {
          count = Number(
            (this.db
              .prepare(`SELECT COUNT(*) AS n FROM ${t}${this.where()}`)
              .get(...(this.whereParams() as never[])) as { n: number }).n,
          );
        }

        if (!this.countHead) {
          const cols = this.columns === "*"
            ? "*"
            : this.columns.split(",").map((c) => ident(c.trim())).join(",");
          const order = this.orders.length ? ` ORDER BY ${this.orders.join(",")}` : "";
          const limit = this.limitN !== null ? ` LIMIT ${this.limitN} OFFSET ${this.offsetN}` : "";
          rows = this.db
            .prepare(`SELECT ${cols} FROM ${t}${this.where()}${order}${limit}`)
            .all(...(this.whereParams() as never[]));
        }
      } else if (this.op === "insert" || this.op === "upsert") {
        for (const row of this.payload) {
          const keys = Object.keys(row);
          const cols = keys.map(ident).join(",");
          const marks = keys.map(() => "?").join(",");
          let sql = keys.length
            ? `INSERT INTO ${t} (${cols}) VALUES (${marks})`
            : `INSERT INTO ${t} DEFAULT VALUES`;

          if (this.op === "upsert" && this.conflict) {
            const cols = this.conflict.split(",").map((c) => c.trim());
            const target = cols.map(ident).join(",");

            if (this.ignoreDup) {
              sql += ` ON CONFLICT(${target}) DO NOTHING`;
            } else {
              const updates = keys
                .filter((k) => !cols.includes(k))
                .map((k) => `${ident(k)} = excluded.${ident(k)}`)
                .join(",");
              sql += ` ON CONFLICT(${target}) DO UPDATE SET ${updates || `${ident(cols[0])} = excluded.${ident(cols[0])}`}`;
            }
          }

          sql += " RETURNING *";
          rows.push(
            ...this.db.prepare(sql).all(...(keys.map((k) => norm(row[k])) as never[])),
          );
        }
      } else if (this.op === "update") {
        const values = this.payload[0];
        const keys = Object.keys(values);
        rows = this.db
          .prepare(
            `UPDATE ${t} SET ${keys.map((k) => `${ident(k)} = ?`).join(",")}${this.where()} RETURNING *`,
          )
          .all(...([...keys.map((k) => norm(values[k])), ...this.whereParams()] as never[]));
      } else {
        rows = this.db
          .prepare(`DELETE FROM ${t}${this.where()} RETURNING *`)
          .all(...(this.whereParams() as never[]));
      }

      // Mutações só devolvem linhas se .select() foi encadeado.
      const visible =
        this.op === "select" || this.returning ? rows : [];

      if (this.mode === "single") {
        if (visible.length !== 1) {
          return { data: null, error: { message: `esperado 1 linha, recebido ${visible.length}`, code: "PGRST116" } };
        }
        return { data: visible[0], error: null, count };
      }

      if (this.mode === "maybe") {
        return { data: visible[0] ?? null, error: null, count };
      }

      return { data: visible, error: null, count };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        data: null,
        error: {
          message,
          code: /UNIQUE/i.test(message) ? "23505" : /FOREIGN KEY/i.test(message) ? "23503" : undefined,
        },
      };
    }
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((value: unknown) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export function createFakeSupabase(db: DatabaseSync) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: async (name: string) => {
      if (name === "reset_identity_sequences") {
        const tables = db
          .prepare("SELECT name FROM sqlite_sequence")
          .all() as { name: string }[];

        for (const { name: table } of tables) {
          db.prepare(
            `UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM ${ident(table)}) WHERE name = ?`,
          ).run(table);
        }
      }

      return { data: null, error: null };
    },
  };
}
