import {
  useEffect,
  useState,
} from "react";

import {
  listProspects,
} from "../features/prospects/prospect.service";

import type {
  ProspectWithCompany,
} from "../features/prospects/prospect.types";

import { STATUS_LABEL } from "../features/prospects/prospect.labels";
import { ErrorMessage } from "../components/ErrorMessage";

interface Props {
  onOpenProspect: (id: number) => void;
}

export function ProspectsPage({ onOpenProspect }: Props) {
  const [prospects, setProspects] = useState<
    ProspectWithCompany[]
  >([]);

  const [error, setError] = useState("");

  useEffect(() => {
    listProspects()
      .then(setProspects)
      .catch((err) => {
        console.error(err);
        setError("Erro ao carregar prospects.");
      });
  }, []);

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">
            EM PROSPECÇÃO
          </span>

          <h2>Empresas que você está trabalhando</h2>
        </div>

        <span className="counter">
          {prospects.length} registros
        </span>
      </div>

      <ErrorMessage message={error} />

      {prospects.length === 0 ? (
        <div className="empty">
          Nenhum prospect ainda.
        </div>
      ) : (
        <div className="tasks-list">
          {prospects.map((prospect) => (
            <article
              className="task-item clickable"
              key={prospect.id}
              onClick={() => onOpenProspect(prospect.id)}
            >
              <div className="task-body">
                <strong>
                  {prospect.company_name}
                </strong>

                <p>
                  {prospect.next_action ?? "—"}
                  {prospect.next_action_at
                    ? ` · ${prospect.next_action_at}`
                    : ""}
                </p>
              </div>

              <span className="status">
                {STATUS_LABEL[prospect.status] ?? prospect.status}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
