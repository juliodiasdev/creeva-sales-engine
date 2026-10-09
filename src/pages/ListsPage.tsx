import { useCallback, useEffect, useState } from "react";

import {
  archiveList,
  loadListsWithStats,
} from "../features/lists/lists.service";
import type { ListWithStats } from "../features/lists/lists.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../lib/format";

interface Props {
  onOpenList: (id: number) => void;
  onNewSearch: () => void;
}

export function ListsPage({ onOpenList, onNewSearch }: Props) {
  const [lists, setLists] = useState<ListWithStats[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setLists(await loadListsWithStats());
      setLoaded(true);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar listas."));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = lists.filter((l) =>
    showArchived ? l.list.status === "ARCHIVED" : l.list.status === "OPEN",
  );

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">CADA PROSPECÇÃO VIRA UMA LISTA</span>
          <h2>{showArchived ? "Listas arquivadas" : "Suas listas"}</h2>
        </div>

        <div className="outreach-actions">
          <button type="button" onClick={onNewSearch}>+ Nova prospecção</button>

          <button
            type="button"
            className="secondary"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Ver em andamento" : "Ver arquivadas"}
          </button>
        </div>
      </div>

      <ErrorMessage message={error} />

      {loaded && visible.length === 0 ? (
        <div className="empty">
          {showArchived
            ? "Nenhuma lista arquivada."
            : "Nenhuma lista ainda. Comece em Prospectar, buscando no Google Maps."}
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
  );
}
