import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { startDiscovery } from "../features/discovery/discovery.service";
import { getSearchRecord } from "../features/discovery/discovery.repository";
import type { SearchRecord } from "../features/discovery/discovery.repository";
import { listJobs } from "../features/jobs/job.service";
import type { Job } from "../features/jobs/job.service";
import { loadListsWithStats } from "../features/lists/lists.service";
import type { ListWithStats } from "../features/lists/lists.service";
import { archiveList } from "../features/lists/lists.service";
import { getSetting } from "../features/settings/settings.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../lib/format";

interface Props {
  onOpenList: (id: number) => void;
}

export function ListsPage({ onOpenList }: Props) {
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [pages, setPages] = useState(1);
  const [previous, setPrevious] = useState<SearchRecord | null>(null);
  const [lists, setLists] = useState<ListWithStats[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const segmentRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [l, j] = await Promise.all([loadListsWithStats(), listJobs(5)]);
      setLists(l);
      setJobs(j);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar listas."));
    }
  }, []);

  useEffect(() => {
    void getSetting("default_city").then((c) => c && setCity(c));
    void refresh();
  }, [refresh]);

  const searching = jobs.find(
    (j) =>
      j.type === "DISCOVERY" &&
      (j.status === "PENDING" || j.status === "RUNNING"),
  );

  useEffect(() => {
    if (!searching) return;

    const timer = setInterval(() => void refresh(), 1500);

    return () => clearInterval(timer);
  }, [searching, refresh]);

  const failed = jobs.find((j) => j.type === "DISCOVERY" && j.status === "FAILED");

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

  async function handleCreate(event: FormEvent) {
    event.preventDefault();

    try {
      setError("");
      setMessage("");
      await startDiscovery(segment, city, { neighborhood, pages });
      setMessage(
        "Buscando no Google Maps… a lista aparece aqui assim que terminar.",
      );
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Erro ao iniciar a busca."));
    }
  }

  const visible = lists.filter((l) =>
    showArchived ? l.list.status === "ARCHIVED" : l.list.status === "OPEN",
  );

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">PASSO 1 · PROSPECTAR</span>
            <h2>Nova lista de contatos</h2>
          </div>
        </div>

        <p className="muted">
          Busca no Google Maps e guarda <strong>somente os dados que o Maps
          mostra</strong> (nome, endereço, telefone, site, avaliações). Nada é
          inventado. Cada busca vira uma lista organizada; lugares já
          coletados antes nunca entram de novo.
        </p>

        <form className="discovery-form" onSubmit={handleCreate}>
          <label>
            Segmento
            <input
              ref={segmentRef}
              value={segment}
              onChange={(e) => setSegment(e.target.value)}
              placeholder="Odontologia"
            />
          </label>
          <label>
            Cidade
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Cuiabá" />
          </label>
          <label>
            Bairro / região (opcional)
            <input
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Jardim das Américas"
            />
          </label>
          <label>
            Quantidade
            <select value={pages} onChange={(e) => setPages(Number(e.target.value))}>
              <option value={1}>até 20 empresas</option>
              <option value={2}>até 40 empresas</option>
              <option value={3}>até 60 empresas</option>
            </select>
          </label>
          <button type="submit" disabled={!!searching}>
            {searching ? "Buscando…" : "Criar lista"}
          </button>
        </form>

        {previous && (
          <p className="muted">
            Você já buscou isso em {formatDateTime(previous.last_run_at)} (
            {previous.runs}×, {previous.last_imported} novas). Repetir só traz
            lugares ainda não coletados — use outro bairro para ampliar.
          </p>
        )}

        {searching && (
          <p className="muted">Busca em andamento… {searching.progress}%</p>
        )}

        {failed && !searching && failed.error && (
          <p className="error">Última busca falhou: {failed.error}</p>
        )}

        {message && <p className="muted">{message}</p>}
        <ErrorMessage message={error} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">SUAS LISTAS</span>
            <h2>{showArchived ? "Listas arquivadas" : "Listas em andamento"}</h2>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Ver em andamento" : "Ver arquivadas"}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            {showArchived
              ? "Nenhuma lista arquivada."
              : "Nenhuma lista ainda. Crie a primeira acima."}
          </div>
        ) : (
          <div className="tasks-list">
            {visible.map(({ list, stats, next }) => (
              <article className="task-item" key={list.id}>
                <div className="task-body">
                  <strong
                    className="clickable"
                    onClick={() => onOpenList(Number(list.id))}
                  >
                    {list.name}
                  </strong>
                  <p>
                    {stats.total} empresas · criada em{" "}
                    {formatDateTime(list.created_at)}
                  </p>
                  <p>
                    {stats.discovered} captadas · {stats.enriched} enriquecidas ·{" "}
                    {stats.qualified} qualificadas · {stats.ready} em abordagem ·{" "}
                    {stats.disqualified} descartadas
                  </p>
                  <p className="muted">
                    Próximo passo: <strong>{next.title}</strong> — {next.detail}
                  </p>
                </div>

                <div className="task-actions">
                  <button type="button" onClick={() => onOpenList(Number(list.id))}>
                    {next.step === 6 ? "Abrir" : `${next.title} →`}
                  </button>

                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      void archiveList(Number(list.id), !showArchived).then(refresh)
                    }
                  >
                    {showArchived ? "Reabrir" : "Arquivar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
