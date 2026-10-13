import { AUTOMATION_LEVEL_LABEL, SOURCE_LABEL, STATE_LABEL } from "./automation.engine";
import type { AutomationReport, AutomationState } from "./automation.engine";

const STATE_CLASS: Record<AutomationState, string> = {
  ALREADY: "ok",
  CONFIRMED_GAP: "missing",
  NOT_FOUND: "partial",
  UNKNOWN: "unknown",
  NOT_APPLICABLE: "unknown",
};

const LEVEL_CLASS = { HIGH: "ok", MEDIUM: "partial", LOW: "unknown", UNDEFINED: "unknown" } as const;

/**
 * Potencial de automação: cada linha mostra de onde veio a informação e o que perguntar
 * para confirmar. O que não dá para saber de fora aparece como "não dá para saber".
 */
export function AutomationPanel({ report }: { report: AutomationReport }) {
  const shown = report.areas.filter((a) => a.state !== "NOT_APPLICABLE");
  const hidden = report.areas.filter((a) => a.state === "NOT_APPLICABLE");

  return (
    <div className="ficha-group automation">
      <h3 className="group-title">
        Potencial de automação · <span className={`fs fs-${LEVEL_CLASS[report.level]}`}>{AUTOMATION_LEVEL_LABEL[report.level]}</span>
      </h3>

      <p>{report.summary}</p>
      <p className="muted small">
        {Math.round(report.confidence * 100)}% das áreas aplicáveis puderam ser verificadas por fora.
      </p>

      <table className="ficha-table automation-table">
        <thead>
          <tr>
            <th scope="col">Área</th>
            <th scope="col">Situação</th>
            <th scope="col">O que encontramos (e de onde veio)</th>
            <th scope="col">Confirmar na conversa</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((a) => (
            <tr key={a.key}>
              <th scope="row">{a.label}</th>
              <td>
                <span className={`fs fs-${STATE_CLASS[a.state]}`}>{STATE_LABEL[a.state]}</span>
              </td>
              <td>
                {a.evidence.length === 0 ? (
                  <span className="muted">Nada para ver por fora.</span>
                ) : (
                  <ul className="reasons">
                    {a.evidence.map((e) => (
                      <li key={e.source + e.text}>
                        <small className="muted">{SOURCE_LABEL[e.source]}:</small> {e.text}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="muted">{a.state === "ALREADY" ? "—" : a.question}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {hidden.length > 0 && (
        <p className="muted small">
          Sem sinal de que se aplica a esta empresa: {hidden.map((a) => a.label).join("; ")}.
        </p>
      )}

      <ul className="reasons muted small">
        {report.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
