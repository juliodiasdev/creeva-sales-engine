import { useCallback, useEffect, useState } from "react";

import { channelOpenUrl, CHANNEL_LABEL } from "../contacts/channels.engine";
import { SIGNAL_LABEL } from "../../lib/labels";
import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage, formatPhone } from "../../lib/format";
import { openExternal } from "../../lib/opener";

import {
  CALL_OUTCOME_LABEL,
  loadCallDossier,
  recordCallOutcome,
  saveBottleneckFeedback,
} from "./call.service";
import type { BottleneckVerdict, CallDossier, CallOutcome } from "./call.service";

const OUTCOMES = Object.keys(CALL_OUTCOME_LABEL) as CallOutcome[];

const VERDICT_LABEL: Record<BottleneckVerdict, string> = {
  CONFIRMED: "Confirmado",
  WRONG: "Errado",
  UNKNOWN: "Não sei",
};

/**
 * Dossiê para a ligação: gargalos com a evidência que os comprova, uma
 * pergunta de descoberta para cada um, contatos e o registro do resultado.
 */
export function CallPanel({
  companyId,
  prospectId,
  onChanged,
}: {
  companyId: number;
  prospectId: number;
  onChanged: () => void;
}) {
  const [dossier, setDossier] = useState<CallDossier | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome>("NO_ANSWER");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setDossier(await loadCallDossier(companyId));
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar o dossiê."));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>, after?: () => void) {
    try {
      setBusy(true);
      setError("");
      await fn();
      after?.();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir."));
    } finally {
      setBusy(false);
    }
  }

  if (!dossier) return <ErrorMessage message={error} />;

  const phone = dossier.contacts.find((c) => c.kind === "PHONE" || c.kind === "WHATSAPP");

  return (
    <div className="call-panel">
      {dossier.hasDiagnosis ? (
        dossier.bottlenecks.length > 0 ? (
          <>
            {dossier.opening && (
              <p className="muted">
                <strong>Como abrir:</strong> {dossier.opening}
              </p>
            )}

            {dossier.bottlenecks.map((b) => (
              <div className="bottleneck" key={b.title}>
                <strong>{b.title}</strong>
                <small className="muted">
                  Evidência: {b.evidence.map((e) => SIGNAL_LABEL[e] ?? e).join(", ")} · confiança{" "}
                  {Math.round(b.confidence * 100)}%
                </small>
                {b.question && <small>Pergunte: “{b.question}”</small>}

                <span className="verdicts" role="group" aria-label={`Esse gargalo é real? ${b.title}`}>
                  {(Object.keys(VERDICT_LABEL) as BottleneckVerdict[]).map((v) => (
                    <button
                      type="button"
                      key={v}
                      className={b.verdict === v ? "chip active" : "chip"}
                      aria-pressed={b.verdict === v}
                      disabled={busy}
                      onClick={() =>
                        void run(() => saveBottleneckFeedback(companyId, b, v), () => void load())
                      }
                    >
                      {VERDICT_LABEL[v]}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </>
        ) : (
          <p className="muted">
            O diagnóstico não encontrou gargalo com evidência suficiente. Pergunte como a empresa
            atrai e atende clientes hoje.
          </p>
        )
      ) : (
        <p className="muted">
          Sem diagnóstico de IA para esta empresa. Use "Enriquecer" na lista com o diagnóstico de
          gargalos marcado.
        </p>
      )}

      {dossier.automation.length > 0 && (
        <div className="automation-ask">
          <strong>Descobrir na conversa (automação)</strong>
          <small className="muted">
            Isso é o que NÃO dá para saber de fora: pergunte, não afirme.
          </small>
          <ul className="reasons">
            {dossier.automation.map((a) => (
              <li key={a.area}>
                <strong>{a.area}</strong> — {a.stateLabel}
                {a.found.length > 0 && <small className="muted"> · {a.found.join(" ")}</small>}
                <br />
                Pergunte: “{a.question}”
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="outreach-actions">
        {phone && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void openExternal(channelOpenUrl(phone)).catch((e) =>
                setError(errorMessage(e, "Erro ao abrir.")),
              )
            }
          >
            {phone.kind === "WHATSAPP" ? "Abrir WhatsApp" : "Ligar"}:{" "}
            {formatPhone(phone.value)} ({CHANNEL_LABEL[phone.kind]})
          </button>
        )}
      </div>

      <div className="outreach-actions">
        <select
          aria-label="Resultado da ligação"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as CallOutcome)}
        >
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {CALL_OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>

        <input
          aria-label="Observação da ligação"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Observação (opcional)"
        />

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              () => recordCallOutcome({ prospectId, outcome, note }),
              () => {
                setNote("");
                onChanged();
              },
            )
          }
        >
          Registrar ligação
        </button>
      </div>

      <ErrorMessage message={error} />
    </div>
  );
}
