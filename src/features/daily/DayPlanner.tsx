import { useCallback, useEffect, useState } from "react";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage } from "../../lib/format";
import { getJob } from "../jobs/job.service";
import type { Job } from "../jobs/job.service";
import { getSetting } from "../settings/settings.service";

import { DEFAULT_DAY_SIZE, getLastDayRun, planDay, startDay } from "./daily.service";
import type { DayCandidate, DayRunResult } from "./daily.service";

/** "Montar o dia": escolhe as melhores qualificadas e deixa tudo pronto para ligar. */
export function DayPlanner({ onDone }: { onDone: () => void }) {
  const [candidates, setCandidates] = useState<DayCandidate[] | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [hasKey, setHasKey] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<DayRunResult | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, key, last] = await Promise.all([
        planDay(DEFAULT_DAY_SIZE),
        getSetting("openai_api_key"),
        getLastDayRun(),
      ]);

      setCandidates(c);
      setHasKey(!!key);
      setUseAi(!!key);
      setLastRun(last);
    } catch (err) {
      setError(errorMessage(err, "Erro ao montar o dia."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const running = job?.status === "PENDING" || job?.status === "RUNNING";

  useEffect(() => {
    if (!job || !running) return;

    const timer = setInterval(() => {
      void getJob(job.id).then((j) => {
        if (!j) return;

        setJob(j);

        if (j.status === "COMPLETED") {
          setResult(j.result ? (JSON.parse(j.result) as DayRunResult) : null);
          onDone();
          void load();
        } else if (j.status === "FAILED") {
          setError(j.error ?? "A montagem do dia falhou.");
        }
      });
    }, 1200);

    return () => clearInterval(timer);
  }, [job, running, onDone, load]);

  async function start() {
    if (!candidates?.length) return;

    try {
      setError("");
      setResult(null);

      const id = await startDay(
        candidates.map((c) => c.companyId),
        { useAi },
      );

      setJob(await getJob(id));
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar."));
    }
  }

  if (!candidates) return error ? <ErrorMessage message={error} /> : null;

  const today = new Date().toISOString().slice(0, 10);
  const missing = candidates.filter((c) => !c.hasFreshDiagnosis).length;

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">TODO DIA</span>
          <h2>Montar o dia</h2>
        </div>

        {lastRun && (
          <span className="counter">
            {lastRun === today ? "Dia já montado hoje" : `Última vez: ${lastRun}`}
          </span>
        )}
      </div>

      {candidates.length === 0 ? (
        <div className="empty">
          Nenhuma empresa qualificada esperando. Qualifique empresas em uma lista para montar o dia.
        </div>
      ) : (
        <>
          <p className="muted">
            {candidates.length === 1
              ? "A empresa que você qualificou: "
              : `As ${candidates.length} melhores empresas que você qualificou, da maior pontuação para a menor: `}
            {candidates
              .slice(0, 5)
              .map((c) => c.name)
              .join(", ")}
            {candidates.length > 5 ? "…" : ""}
          </p>

          <label className="check">
            <input
              type="checkbox"
              checked={useAi && hasKey}
              disabled={!hasKey}
              onChange={(e) => setUseAi(e.target.checked)}
            />
            <span>
              <strong>Diagnosticar gargalos com a IA</strong>
              <small>
                {hasKey
                  ? `A OpenAI analisa os dados reais de ${missing} empresa(s) sem diagnóstico recente (centavos por empresa).`
                  : "Configure a chave da OpenAI em Configurações para usar."}
              </small>
            </span>
          </label>

          <div className="outreach-actions">
            <button type="button" disabled={running} onClick={() => void start()}>
              {running
                ? `Montando… ${job?.progress ?? 0}%`
                : `Montar o dia (${candidates.length})`}
            </button>
          </div>
        </>
      )}

      {result && (
        <p className="muted">
          Pronto: {result.prospected} empresa(s) na lista de ligações de hoje
          {result.diagnosed > 0 ? `, ${result.diagnosed} diagnóstico(s) novo(s)` : ""}
          {result.aiFailed > 0 ? `; a IA falhou em ${result.aiFailed}` : ""}
          {result.failed > 0 ? `; ${result.failed} não puderam entrar` : ""}.
          {result.errors.length > 0 ? ` Detalhe: ${result.errors.join(" | ")}` : ""}
        </p>
      )}

      <ErrorMessage message={error} />
    </section>
  );
}
