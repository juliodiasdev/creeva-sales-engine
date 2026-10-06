import { getDatabase } from "../../lib/database";

export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED";

export interface Job {
  id: number;
  type: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type ReportProgress = (percent: number) => Promise<void>;

/**
 * Executa uma operação longa registrando o ciclo de vida em `jobs`.
 * Retorna o id imediatamente; o trabalho segue assíncrono para não
 * travar a UI (que acompanha por polling com listJobs).
 */
export async function startJob<T>(
  type: string,
  work: (report: ReportProgress) => Promise<T>,
): Promise<number> {
  const db = await getDatabase();

  const created = await db.execute(
    `INSERT INTO jobs (type) VALUES ($1)`,
    [type],
  );

  const id = Number(created.lastInsertId);

  void (async () => {
    try {
      await db.execute(
        `UPDATE jobs SET status='RUNNING', started_at=datetime('now') WHERE id=$1`,
        [id],
      );

      const result = await work(async (percent) => {
        await db.execute(
          `UPDATE jobs SET progress=$2 WHERE id=$1`,
          [id, Math.max(0, Math.min(100, Math.round(percent)))],
        );
      });

      await db.execute(
        `UPDATE jobs SET status='COMPLETED', progress=100, result=$2, finished_at=datetime('now') WHERE id=$1`,
        [id, JSON.stringify(result ?? null)],
      );
    } catch (err) {
      await db.execute(
        `UPDATE jobs SET status='FAILED', error=$2, finished_at=datetime('now') WHERE id=$1`,
        [
          id,
          err instanceof Error ? err.message : String(err),
        ],
      );
    }
  })();

  return id;
}

export async function listJobs(limit = 20): Promise<Job[]> {
  const db = await getDatabase();

  return db.select<Job[]>(
    `SELECT * FROM jobs ORDER BY id DESC LIMIT $1`,
    [limit],
  );
}

export async function getJob(id: number): Promise<Job | null> {
  const db = await getDatabase();

  const rows = await db.select<Job[]>(
    `SELECT * FROM jobs WHERE id = $1`,
    [id],
  );

  return rows[0] ?? null;
}
