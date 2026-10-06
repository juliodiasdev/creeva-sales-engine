import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { listProspects } from "../features/prospects/prospect.service";
import type {
  ProspectStatus,
  ProspectWithCompany,
} from "../features/prospects/prospect.types";
import {
  ALL_STATUSES,
  OTHER_STATUSES,
  PIPELINE_COLUMNS,
  STATUS_LABEL,
} from "../features/prospects/prospect.labels";

import {
  changeProspectStatus,
  GUARDED_STATUSES,
} from "../features/workflow/workflow.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

interface Props {
  onOpenProspect: (id: number) => void;
}

export function PipelinePage({
  onOpenProspect,
}: Props) {
  const [prospects, setProspects] = useState<
    ProspectWithCompany[]
  >([]);

  const [showOthers, setShowOthers] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setProspects(await listProspects());
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Erro ao carregar pipeline."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMove(
    prospect: ProspectWithCompany,
    to: ProspectStatus,
  ) {
    // Estágios que exigem dados são concluídos na página de detalhe.
    if (GUARDED_STATUSES.includes(to)) {
      onOpenProspect(prospect.id);
      return;
    }

    try {
      setError("");
      await changeProspectStatus(prospect.id, to);
      await load();
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Erro ao mover prospect."));
    }
  }

  function card(p: ProspectWithCompany) {
    return (
      <article className="pipeline-card" key={p.id}>
        <strong>{p.company_name}</strong>
        <small>
          Score {p.score} · {p.next_action || "sem próxima ação"}
        </small>

        <div className="outreach-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => onOpenProspect(p.id)}
          >
            Abrir
          </button>

          <select
            value=""
            onChange={(e) =>
              void handleMove(p, e.target.value as ProspectStatus)
            }
          >
            <option value="">Mover…</option>
            {ALL_STATUSES.filter((s) => s !== p.status).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </article>
    );
  }

  const columns = showOthers
    ? OTHER_STATUSES
    : PIPELINE_COLUMNS;

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">PIPELINE</span>
          <h2>Funil comercial</h2>
        </div>

        <button
          type="button"
          className="secondary"
          onClick={() => setShowOthers((v) => !v)}
        >
          {showOthers
            ? "Ver funil principal"
            : "Ver perdidos / nutrição / descartados"}
        </button>
      </div>

      <ErrorMessage message={error} />

      <div className="pipeline">
        {columns.map((status) => {
          const items = prospects.filter(
            (p) => p.status === status,
          );

          return (
            <div className="pipeline-column" key={status}>
              <h3>
                {STATUS_LABEL[status]}{" "}
                <small>({items.length})</small>
              </h3>

              {items.map(card)}
            </div>
          );
        })}
      </div>
    </section>
  );
}
