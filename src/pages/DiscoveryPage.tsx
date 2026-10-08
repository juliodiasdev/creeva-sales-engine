import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { startDiscovery } from "../features/discovery/discovery.service";
import type { DiscoveryResult } from "../features/discovery/discovery.service";
import {
  getSearchRecord,
  listSearches,
} from "../features/discovery/discovery.repository";
import type { SearchRecord } from "../features/discovery/discovery.repository";

import { EnrichDialog } from "../features/enrichment/EnrichDialog";
import { startEnrichmentForDiscovered } from "../features/enrichment/enrichment.service";

import { loadContactRows } from "../features/export/export.service";
import { downloadXlsx } from "../features/export/download";
import { listJobs } from "../features/jobs/job.service";
import type { Job } from "../features/jobs/job.service";
import { getSetting } from "../features/settings/settings.service";

import { label, JOB_STATUS_LABEL, JOB_TYPE_LABEL } from "../lib/labels";
import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../lib/format";

function parseResult(job: Job): DiscoveryResult | null {
  try {
    return job.result ? (JSON.parse(job.result) as DiscoveryResult) : null;
  } catch {
    return null;
  }
}

export function DiscoveryPage() {
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [pages, setPages] = useState(1);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [history, setHistory] = useState<SearchRecord[]>([]);
  const [previous, setPrevious] = useState<SearchRecord | null>(null);
  const [offerFor, setOfferFor] = useState<number[] | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [handled, setHandled] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [j, h] = await Promise.all([listJobs(10), listSearches(8)]);
      setJobs(j);
      setHistory(h);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar jobs."));
    }
  }, []);

  useEffect(() => {
    void getSetting("default_city").then((c) => c && setCity(c));
    void refresh();
  }, [refresh]);

  const running = jobs.some(
    (j) => j.status === "PENDING" || j.status === "RUNNING",
  );

  // Polling só enquanto há job em andamento.
  useEffect(() => {
    if (!running) return;

    const timer = setInterval(() => void refresh(), 1500);

    return () => clearInterval(timer);
  }, [running, refresh]);

  // Busca terminada: oferece (sem executar) o enriquecimento das novas.
  useEffect(() => {
    const done = jobs.find(
      (j) =>
        j.type === "DISCOVERY" &&
        j.status === "COMPLETED" &&
        !handled.includes(j.id),
    );

    if (!done) return;

    setHandled((h) => [...h, done.id]);

    const result = parseResult(done);

    if (result && result.companyIds.length > 0) {
      setOfferFor(result.companyIds);
    }
  }, [jobs, handled]);

  // Aviso se a mesma busca já foi feita.
  useEffect(() => {
    if (!segment.trim() || !city.trim()) {
      setPrevious(null);
      return;
    }

    const timer = setTimeout(() => {
      void getSearchRecord(segment.trim(), city.trim(), neighborhood.trim() || undefined)
        .then(setPrevious)
        .catch(() => setPrevious(null));
    }, 400);

    return () => clearTimeout(timer);
  }, [segment, city, neighborhood]);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();

    try {
      setError("");
      setMessage("");
      await startDiscovery(segment, city, { neighborhood, pages });
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar busca."));
    }
  }

  async function exportSheet() {
    try {
      setError("");
      const rows = await loadContactRows();
      await downloadXlsx(rows);
      setMessage(`Planilha gerada com ${rows.length} empresa(s).`);
    } catch (err) {
      setError(errorMessage(err, "Erro ao gerar a planilha."));
    }
  }

  async function enrichPending() {
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
            <span className="eyebrow">BUSCAR EMPRESAS</span>
            <h2>Encontrar empresas no Google</h2>
          </div>
        </div>

        <p className="muted">
          Resultados viram empresas, nunca prospects automaticamente. Lugares
          já coletados antes são ignorados (nunca repetem nem são cobrados de
          novo).
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
          <label>
            Bairro / região (opcional)
            <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Jardim das Américas" />
          </label>
          <label>
            Profundidade
            <select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
              <option value={1}>20 resultados</option>
              <option value={2}>até 40</option>
              <option value={3}>até 60</option>
            </select>
          </label>
          <button type="submit" disabled={running}>Buscar</button>
        </form>

        {previous && (
          <p className="muted">
            Você já buscou isso em {formatDateTime(previous.last_run_at)} (
            {previous.runs}×, {previous.last_imported} novas). Repetir só
            traz lugares ainda não coletados — use outro bairro para ampliar.
          </p>
        )}

        <div className="outreach-actions">
          <button
            type="button"
            className="secondary"
            disabled={running}
            onClick={() => void enrichPending()}
          >
            Enriquecer novas empresas (até 50)
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => void exportSheet()}
          >
            Exportar planilha (Excel)
          </button>
        </div>

        {message && <p className="muted">{message}</p>}
        <ErrorMessage message={error} />
      </section>

      {offerFor && (
        <EnrichDialog
          companyIds={offerFor}
          onClose={() => setOfferFor(null)}
          onStarted={() => {
            setOfferFor(null);
            setMessage("Enriquecimento iniciado. Acompanhe nas execuções abaixo.");
            void refresh();
          }}
        />
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>Execuções em andamento e recentes</h2>
        </div>

        {jobs.length === 0 ? (
          <div className="empty">Nenhuma execução ainda.</div>
        ) : (
          <div className="tasks-list">
            {jobs.map((j) => {
              const r = j.type === "DISCOVERY" ? parseResult(j) : null;

              return (
                <article className="task-item" key={j.id}>
                  <div className="task-body">
                    <strong>{label(JOB_TYPE_LABEL, j.type)} #{j.id}</strong>
                    <p>
                      {label(JOB_STATUS_LABEL, j.status)} · {j.progress}%
                      {j.error ? ` · ${j.error}` : ""}
                      {r
                        ? ` · ${r.found} encontradas, ${r.imported} novas, ${r.duplicates} duplicadas, ${r.alreadySeen} já coletadas antes`
                        : ""}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <h2>Buscas anteriores</h2>
          </div>

          <div className="tasks-list">
            {history.map((h) => (
              <article className="task-item" key={h.id}>
                <div className="task-body">
                  <strong>
                    {h.segment} — {h.neighborhood ? `${h.neighborhood}, ` : ""}{h.city}
                  </strong>
                  <p>
                    {h.runs}× · última: {formatDateTime(h.last_run_at)} ·{" "}
                    {h.last_imported} novas de {h.last_found}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
