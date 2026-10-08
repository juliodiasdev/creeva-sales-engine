import { getSupabase, nowIso, unwrap } from "../../lib/store";

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

async function patch(id: number, values: Record<string, unknown>) {
  unwrap(await getSupabase().from("jobs").update(values).eq("id", id));
}

/**
 * Executa uma operação longa registrando o ciclo de vida em `jobs`.
 * Retorna o id imediatamente; o trabalho segue assíncrono para não
 * travar a UI (que acompanha por polling com listJobs).
 */
export async function startJob<T>(
  type: string,
  work: (report: ReportProgress) => Promise<T>,
): Promise<number> {
  const created = unwrap(
    await getSupabase()
      .from("jobs")
      .insert({ type })
      .select("id")
      .single(),
  ) as { id: number };

  const id = Number(created.id);

  void (async () => {
    try {
      await patch(id, { status: "RUNNING", started_at: nowIso() });

      const result = await work(async (percent) => {
        await patch(id, {
          progress: Math.max(0, Math.min(100, Math.round(percent))),
        });
      });

      await patch(id, {
        status: "COMPLETED",
        progress: 100,
        result: JSON.stringify(result ?? null),
        finished_at: nowIso(),
      });
    } catch (err) {
      await patch(id, {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
        finished_at: nowIso(),
      });
    }
  })();

  return id;
}

export async function listJobs(limit = 20): Promise<Job[]> {
  return unwrap(
    await getSupabase()
      .from("jobs")
      .select("*")
      .order("id", { ascending: false })
      .limit(limit),
  ) as Job[];
}

export async function getJob(id: number): Promise<Job | null> {
  return unwrap(
    await getSupabase()
      .from("jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  ) as Job | null;
}
