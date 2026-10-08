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
