import { useState } from "react";

import {
  confirmGroupWithAi,
  mergeCompanies,
  scanDuplicates,
} from "./duplicates.service";
import type { AiVerdict } from "./duplicates.service";
import type { DuplicateGroup } from "./duplicates.engine";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage } from "../../lib/format";

const MAX_AI_GROUPS = 15;

export function DuplicatesPanel({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [masters, setMasters] = useState<Record<number, number>>({});
  const [verdicts, setVerdicts] = useState<Record<number, AiVerdict | string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const keyOf = (g: DuplicateGroup) => g.members[0].id;

  async function scan() {
    try {
      setError("");
      setMessage("");
      setBusy("scan");
      const found = await scanDuplicates();
      setGroups(found);
      setVerdicts({});
      setMasters(
        Object.fromEntries(found.map((g) => [keyOf(g), g.members[0].id])),
      );
      setMessage(
        found.length === 0
          ? "Nenhum possível duplicado encontrado. Base organizada."
          : `${found.length} grupo(s) de possíveis duplicados.`,
      );
    } catch (err) {
      setError(errorMessage(err, "Erro ao procurar duplicados."));
    } finally {
      setBusy("");
    }
  }

  async function askAi() {
    if (!groups) return;

    setBusy("ai");
    setError("");

    const next: Record<number, AiVerdict | string> = {};
    const nextMasters = { ...masters };

    for (const group of groups.slice(0, MAX_AI_GROUPS)) {
      try {
        const verdict = await confirmGroupWithAi(group);
        next[keyOf(group)] = verdict;

        if (verdict.same_entity) {
          nextMasters[keyOf(group)] = verdict.master_id;
        }
      } catch (err) {
        next[keyOf(group)] = errorMessage(err, "Falha na IA.");
      }
    }

    setVerdicts(next);
    setMasters(nextMasters);
    setBusy("");
  }

  async function merge(group: DuplicateGroup) {
    const masterId = masters[keyOf(group)];

    try {
      setError("");
      setBusy(`merge-${keyOf(group)}`);

      for (const member of group.members) {
        if (member.id !== masterId) {
          await mergeCompanies(masterId, member.id);
        }
      }

      setGroups((current) =>
        current ? current.filter((g) => keyOf(g) !== keyOf(group)) : current,
      );
      setMessage("Registros mesclados.");
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Erro ao mesclar."));
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return (
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">ORGANIZAÇÃO</span>
            <h2>Duplicados</h2>
            <p className="muted">
              Encontra empresas repetidas (nome parecido, mesmo site ou
              telefone) e mescla sem perder histórico.
            </p>
          </div>

          <button type="button" onClick={() => { setOpen(true); void scan(); }}>
            Organizar duplicados
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ORGANIZAÇÃO</span>
          <h2>Duplicados</h2>
        </div>

        <div className="outreach-actions">
          <button type="button" className="secondary" disabled={!!busy} onClick={() => void scan()}>
            {busy === "scan" ? "Procurando…" : "Procurar de novo"}
          </button>

          <button
            type="button"
            disabled={!!busy || !groups?.length}
            onClick={() => void askAi()}
          >
            {busy === "ai" ? "IA analisando…" : "Confirmar com IA"}
          </button>

          <button type="button" className="secondary" onClick={() => setOpen(false)}>
            Fechar
          </button>
        </div>
      </div>

      {message && <p className="muted">{message}</p>}
      <ErrorMessage message={error} />

      <div className="tasks-list">
        {groups?.map((group) => {
          const key = keyOf(group);
          const verdict = verdicts[key];

          return (
            <article className="task-item dup-group" key={key}>
              <div className="task-body">
                <p className="muted">{group.reasons.join(" · ")}</p>

                {group.members.map((m) => (
                  <label className="dup-member" key={m.id}>
                    <input
                      type="radio"
                      name={`master-${key}`}
                      checked={masters[key] === m.id}
                      onChange={() => setMasters({ ...masters, [key]: m.id })}
                    />
                    <span>
                      <strong>{m.name}</strong>{" "}
                      <small>
                        {[m.city, m.address, m.phone, m.website]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </label>
                ))}

                {typeof verdict === "string" && (
                  <p className="error">{verdict}</p>
                )}

                {verdict && typeof verdict !== "string" && (
                  <p className="muted">
                    IA: {verdict.same_entity ? "mesma empresa" : "NÃO parece a mesma empresa"}{" "}
                    ({Math.round(verdict.confidence * 100)}%) — {verdict.reason}
                  </p>
                )}
              </div>

              <div className="task-actions">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void merge(group)}
                >
                  {busy === `merge-${key}` ? "Mesclando…" : "Mesclar no selecionado"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
