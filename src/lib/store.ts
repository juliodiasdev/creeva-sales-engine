import { getSupabase } from "./supabase";

export { getSupabase };

interface PostgrestResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/** Converte o retorno {data, error} do Supabase em exceção. */
export function unwrap<T>(result: PostgrestResult<T>): T {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data as T;
}

const PAGE = 1000;

/** PostgREST limita ~1000 linhas por resposta: busca todas em páginas. */
export async function fetchAllPages<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<PostgrestResult<T[]>>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE) {
    const page = unwrap(await build(from, from + PAGE - 1));

    rows.push(...page);

    if (page.length < PAGE) break;
  }

  return rows;
}

/** Busca por lista de ids em lotes (evita URL gigante). */
export async function fetchByIds<T>(
  table: string,
  columns: string,
  idColumn: string,
  ids: number[],
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];

  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);

    rows.push(
      ...unwrap(
        (await getSupabase()
          .from(table)
          .select(columns)
          .in(idColumn, batch)) as unknown as PostgrestResult<T[]>,
      ),
    );
  }

  return rows;
}

/* ---------- datas (sempre ISO/UTC, calculadas no app) ---------- */

export const nowIso = (): string => new Date().toISOString();

export function inDaysIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Início do dia atual (local) em ISO — usado para "atrasadas". */
export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
