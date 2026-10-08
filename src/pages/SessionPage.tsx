import { useCallback, useEffect, useState } from "react";

import {
  loadNextSessionItem,
} from "../features/outreach/session.service";
import type { SessionItem } from "../features/outreach/session.service";
import {
  markTaskAsSent,
  prepareAiOutreach,
} from "../features/outreach/outreach.service";

import { changeProspectStatus } from "../features/workflow/workflow.service";

import { ChannelButtons } from "../features/contacts/ChannelButtons";
import { label, TASK_TYPE_LABEL } from "../lib/labels";
import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

interface Props {
  onOpenProspect: (id: number) => void;
}

export function SessionPage({ onOpenProspect }: Props) {
  const [item, setItem] = useState<SessionItem | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadNext = useCallback(async (skip: number[]) => {
    try {
      setLoading(true);
      const next = await loadNextSessionItem(skip);
      setItem(next);
      setMessage(next?.draft.message ?? "");
      setCopied(false);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar próximo prospect."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNext([]);
  }, [loadNext]);

  async function act(action: () => Promise<void>, countAsDone = false) {
    try {
      setError("");
      setBusy(true);
      await action();
      if (countAsDone) setDone((n) => n + 1);
      await loadNext(skipped);
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Erro na ação."));
    } finally {
      setBusy(false);
    }
  }

  async function handleAi(taskId: number) {
    try {
      setError("");
      setBusy(true);
      setMessage((await prepareAiOutreach(taskId)).message);
      setCopied(false);
    } catch (err) {
      setError(errorMessage(err, "Erro ao gerar com IA."));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <section className="panel"><p>Carregando…</p></section>;

  if (!item) {
    return (
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">PROSPECTAR AGORA</span>
            <h2>Tudo em dia por aqui</h2>
          </div>
          <span className="counter">{done} enviados nesta rodada</span>
        </div>
        <div className="empty">Nenhuma abordagem pendente agora.</div>
        <ErrorMessage message={error} />
      </section>
    );
  }

  const { task, analysis, signals } = item;

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">PROSPECTAR AGORA</span>
          <h2>{task.company_name}</h2>
          <p className="muted">
            {label(TASK_TYPE_LABEL, task.type)} · pontuação {item.score ?? task.prospect_score}
          </p>
        </div>
        <span className="counter">{done} enviados nesta rodada</span>
      </div>

      {analysis ? (
        <div className="detail-grid">
          <span><strong>Problema:</strong> {analysis.main_problem}</span>
          <span><strong>Oferta sugerida:</strong> {analysis.recommended_offer}</span>
        </div>
      ) : signals.length > 0 ? (
        <ul className="reasons">
          {signals.slice(0, 4).map((s) => (
            <li key={s.id}><strong>{s.type}</strong> — {s.evidence}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sem diagnóstico ainda (enriqueça a empresa para obter sinais).</p>
      )}

      <div className="outreach">
        <textarea
          rows={9}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setCopied(false);
          }}
        />

        {item.draft.channels.length > 0 && (
          <div>
            <small>Abrir com a mensagem pronta:</small>
            <ChannelButtons
              channels={item.draft.channels}
              message={message}
              subject={`Contato — ${task.company_name}`}
            />
          </div>
        )}

        <div className="outreach-actions">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(message);
              setCopied(true);
            }}
          >
            {copied ? "Copiado ✓" : "Copiar"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => markTaskAsSent(task.id, message), true)}
          >
            Enviei
          </button>

          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void handleAi(task.id)}
          >
            Gerar com IA
          </button>

          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              const next = [...skipped, task.id];
              setSkipped(next);
              void loadNext(next);
            }}
          >
            Pular
          </button>

          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(() => changeProspectStatus(task.prospect_id, "DISQUALIFIED"))
            }
          >
            Descartar
          </button>

          <button type="button" className="secondary" onClick={() => onOpenProspect(task.prospect_id)}>
            Abrir detalhes
          </button>
        </div>
      </div>

      <ErrorMessage message={error} />
    </section>
  );
}
