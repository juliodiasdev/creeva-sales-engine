import { useCallback, useEffect, useState } from "react";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../../lib/format";
import { listServices } from "../services/services.service";
import type { Service } from "../services/services.service";
import { VisualReviewPanel } from "../visual/VisualReviewPanel";
import { AutomationPanel } from "../automation/AutomationPanel";

import { LEVEL_LABEL, LEVEL_THRESHOLDS, MOMENT_LABEL } from "./presence.engine";
import type { Check, CheckStatus, SaleMoment } from "./presence.engine";
import { assessAndSavePresence, getPresence } from "./presence.service";
import type { StoredPresence } from "./presence.service";

const CHECK_TEXT: Record<CheckStatus, string> = {
  OK: "Bom",
  WARN: "Atenção",
  FAIL: "Problema",
  UNKNOWN: "Não medido",
};

const CHECK_ICON: Record<CheckStatus, string> = { OK: "✓", WARN: "!", FAIL: "✕", UNKNOWN: "–" };

export function CheckBadge({ status }: { status: CheckStatus }) {
  const cls = { OK: "ok", WARN: "partial", FAIL: "missing", UNKNOWN: "unknown" }[status];

  return (
    <span className={`fs fs-${cls}`} aria-label={CHECK_TEXT[status]}>
      {CHECK_ICON[status]} {CHECK_TEXT[status]}
    </span>
  );
}

export function MomentBadge({ moment }: { moment: SaleMoment }) {
  const cls = { READY: "ok", NEEDS_DATA: "partial", NO_GAP: "unknown" }[moment];

  return <span className={`fs fs-${cls}`}>{MOMENT_LABEL[moment]}</span>;
}

/**
 * Avaliação da presença digital: o check completo (Google, site, redes,
 * contato e conversão), a posição da empresa e o que vender com os motivos.
 */
export function PresencePanel({
  companyId,
  onChanged,
}: {
  companyId: number;
  onChanged?: () => void;
}) {
  const [presence, setPresence] = useState<StoredPresence | null | undefined>(undefined);
  const [services, setServices] = useState<Service[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([getPresence(companyId), listServices(false)]);

      setPresence(p);
      setServices(s);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar a presença digital."));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reassess() {
    try {
      setBusy(true);
      setError("");
      await assessAndSavePresence(companyId);
      await load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível avaliar."));
    } finally {
      setBusy(false);
    }
  }

  const serviceName = (key: string) => services.find((s) => s.key === key)?.name ?? key;

  if (presence === undefined) return <ErrorMessage message={error} />;

  const report = presence?.report;

  return (
    <section className="panel presence">
      <div className="panel-title">
        <div>
          <span className="eyebrow">PRESENÇA DIGITAL</span>
          <h2>
            {report ? LEVEL_LABEL[report.level] : "Ainda não avaliada"}
            {report?.score != null ? ` · nota ${report.score}/100` : ""}
          </h2>
          {presence && (
            <p className="muted">
              {Math.round(presence.confidence * 100)}% dos pontos puderam ser medidos · avaliada em{" "}
              {formatDateTime(presence.computedAt)}
            </p>
          )}
        </div>

        <button type="button" className="secondary" disabled={busy} onClick={() => void reassess()}>
          {busy ? "Avaliando…" : report ? "Reavaliar" : "Avaliar agora"}
        </button>
      </div>

      <ErrorMessage message={error} />

      <VisualReviewPanel
        companyId={companyId}
        onChanged={() => {
          void load();
          onChanged?.();
        }}
      />

      {!report ? (
        <p className="muted">
          Rode "Enriquecer" (com a leitura do site) ou clique em "Avaliar agora" para checar o
          Google Maps, o site, as redes, os contatos e a conversão.
        </p>
      ) : (
        <>
          <div className={`moment-box moment-${report.moment.toLowerCase()}`}>
            <p>
              <MomentBadge moment={report.moment} /> <strong>{report.position}</strong>
            </p>

            {report.blockers.length > 0 && (
              <ul className="reasons">
                {report.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}

            {(report.pending ?? []).length > 0 && (
              <p className="muted small">
                Para completar a avaliação, falta: {(report.pending ?? []).join(" · ")}.
              </p>
            )}

            {report.moment === "READY" && report.offers.length > 0 && (
              <>
                <h3 className="group-title">O que vender e por quê</h3>
                <table className="ficha-table">
                  <thead>
                    <tr>
                      <th scope="col">Serviço</th>
                      <th scope="col">Motivos (o que foi encontrado; "a confirmar" = hipótese)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.offers.map((o) => (
                      <tr key={o.service}>
                        <th scope="row">{serviceName(o.service)}</th>
                        <td>
                          <ul className="reasons">
                            {o.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {report.moment === "NO_GAP" && (
              <p className="muted">
                Não há brecha clara nos pontos medidos. Vale abordar só se houver outro motivo
                (ex.: crescimento, nova unidade) ou se a conversa confirmar alguma das hipóteses de
                automação abaixo.
              </p>
            )}
          </div>

          {report.automation && <AutomationPanel report={report.automation} />}

          {report.dimensions.map((d) => (
            <div key={d.key} className="ficha-group">
              <h3 className="group-title">
                {d.label} {d.score !== null ? `· ${d.score}/100` : "· não medido"}
              </h3>

              <table className="ficha-table presence-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Situação</th>
                    <th scope="col">O que foi encontrado</th>
                    <th scope="col">Serviço que resolve</th>
                  </tr>
                </thead>
                <tbody>
                  {d.checks.map((c: Check) => (
                    <tr key={c.id}>
                      <th scope="row">{c.label}</th>
                      <td>
                        <CheckBadge status={c.status} />
                      </td>
                      <td className="muted">{c.detail}</td>
                      <td>{c.status === "FAIL" || c.status === "WARN" ? (c.service ? serviceName(c.service) : "—") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <p className="muted small">
            Nota: abaixo de {LEVEL_THRESHOLDS.BASIC} = básica · {LEVEL_THRESHOLDS.BASIC} a{" "}
            {LEVEL_THRESHOLDS.INTERMEDIATE - 1} = intermediária · {LEVEL_THRESHOLDS.INTERMEDIATE}+ =
            avançada (e só se nada medido indicar site antigo ou imagem defasada). Sem site e sem redes = sem presença.
          </p>

          <ul className="reasons muted small">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
