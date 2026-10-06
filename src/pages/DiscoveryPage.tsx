import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { startDiscovery } from "../features/discovery/discovery.service";
import { startEnrichmentForDiscovered } from "../features/enrichment/enrichment.service";
import { listJobs } from "../features/jobs/job.service";
import type { Job } from "../features/jobs/job.service";
import { getSetting } from "../features/settings/settings.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

export function DiscoveryPage() {
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setJobs(await listJobs(10));
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar jobs."));
    }
  }, []);

  useEffect(() => {
    void getSetting("default_city").then((c) => c && setCity(c));
    void refresh();
  }, [refresh]);

  const running = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");

  // Polling só enquanto há job em andamento.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), 1500);
    return () => clearInterval(timer);
  }, [running, refresh]);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();

    try {
      setError("");
      await startDiscovery(segment, city);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar busca."));
    }
  }

  async function handleEnrichPending() {
    try {
      setError("");
      await startEnrichmentForDiscovered(50);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar enriquecimento."));
    }
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">DISCOVERY</span>
            <h2>Buscar empresas (Google Places)</h2>
          </div>
        </div>

        <p className="muted">
          Resultados viram Companies (com deduplicação), nunca Prospects automaticamente.
        </p>

        <form className="discovery-form" onSubmit={handleSearch}>
          <label>
            Segmento
            <input value={segment} onChange={(e) => setSegment(e.target.value)} placeholder="Odontologia" />
          </label>
          <label>
            Cidade
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cuiabá" />
          </label>
          <button type="submit" disabled={running}>Buscar</button>
          <button type="button" className="secondary" disabled={running} onClick={() => void handleEnrichPending()}>
            Enriquecer descobertas (até 50)
          </button>
        </form>

        <ErrorMessage message={error} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Jobs</h2>
        </div>

        {jobs.length === 0 ? (
          <div className="empty">Nenhum job executado.</div>
        ) : (
          <div className="tasks-list">
            {jobs.map((j) => (
              <article className="task-item" key={j.id}>
                <div className="task-body">
                  <strong>{j.type} #{j.id}</strong>
                  <p>
                    {j.status} · {j.progress}%
                    {j.error ? ` · ${j.error}` : ""}
                    {j.status === "COMPLETED" && j.type === "DISCOVERY" && j.result
                      ? ` · ${j.result}`
                      : ""}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
