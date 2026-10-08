import { useCallback, useEffect, useState } from "react";

import {
  listScripts,
  updateScript,
} from "../features/playbook/playbook.service";
import type { PlaybookScript } from "../features/playbook/playbook.service";

import { label, PLAYBOOK_KIND_LABEL } from "../lib/labels";
import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

export function PlaybookPage() {
  const [scripts, setScripts] = useState<PlaybookScript[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setScripts(await listScripts());
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar playbook."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(id: number) {
    try {
      setError("");
      await updateScript(id, draft);
      setEditing(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, "Erro ao salvar script."));
    }
  }

  const segments = [...new Set(scripts.map((s) => s.segment))];

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">MENSAGENS PRONTAS</span>
          <h2>Mensagens por segmento</h2>
        </div>
      </div>

      <p className="muted">
        Variáveis: {"{{empresa}}"}, {"{{agencia}}"}, {"{{cidade}}"},{" "}
        {"{{vendedor}}"}. A tela "Hoje" usa estas mensagens na abordagem.
      </p>

      <ErrorMessage message={error} />

      {segments.map((segment) => (
        <div key={segment}>
          <h3 className="group-title">{segment}</h3>

          <div className="tasks-list">
            {scripts
              .filter((s) => s.segment === segment)
              .map((s) => (
                <article className="task-item" key={s.id}>
                  <div className="task-body">
                    <strong>{label(PLAYBOOK_KIND_LABEL, s.kind)}</strong>

                    {editing === s.id ? (
                      <div className="outreach">
                        <textarea
                          rows={6}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                        />
                        <div className="outreach-actions">
                          <button type="button" onClick={() => void save(s.id)}>
                            Salvar
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setEditing(null)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="script-body">{s.body}</p>
                    )}
                  </div>

                  {editing !== s.id && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setEditing(s.id);
                        setDraft(s.body);
                      }}
                    >
                      Editar
                    </button>
                  )}
                </article>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}
