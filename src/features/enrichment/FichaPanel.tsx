import { Fragment, useCallback, useEffect, useState } from "react";

import { ErrorMessage } from "../../components/ErrorMessage";
import { errorMessage } from "../../lib/format";
import { openExternal } from "../../lib/opener";

import { decideFinding, searchCompanyWithAi } from "./aisearch.service";
import { loadFicha } from "./ficha.service";
import type { Ficha, FichaRow, FichaStatus } from "./ficha.service";
import type { StoredFinding } from "./findings.repository";

export const STATUS_TEXT: Record<FichaStatus, string> = {
  OK: "Tem",
  PARTIAL: "Confirmar",
  SUGGESTED: "Sugestão da IA",
  MISSING: "Falta",
};

export const STATUS_ICON: Record<FichaStatus, string> = {
  OK: "✓",
  PARTIAL: "◐",
  SUGGESTED: "?",
  MISSING: "✕",
};

export function StatusBadge({
  status,
  compact = false,
}: {
  status: FichaStatus;
  /** Só o ícone (tabelas largas); o texto fica no tooltip e para leitores de tela. */
  compact?: boolean;
}) {
  return (
    <span
      className={`fs fs-${status.toLowerCase()}`}
      title={STATUS_TEXT[status]}
      aria-label={STATUS_TEXT[status]}
    >
      {STATUS_ICON[status]}
      {!compact && ` ${STATUS_TEXT[status]}`}
    </span>
  );
}

/** Legenda única das 4 situações (usada na ficha e na visão da lista). */
export function StatusLegend() {
  return (
    <p className="muted small fs-legend">
      {(Object.keys(STATUS_TEXT) as FichaStatus[]).map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
      <span>
        {" "}
        “Confirmar” = veio do Google, mas ainda não foi confirmado · “Sugestão da IA” = você decide.
      </span>
    </p>
  );
}

/**
 * Ficha de enriquecimento de uma empresa: o que TEM, o que FALTA e o que
 * melhorar. Nenhum dado da IA entra sem a sua decisão (aceitar/rejeitar).
 */
export function FichaPanel({
  companyId,
  onChanged,
  onClose,
}: {
  companyId: number;
  onChanged?: () => void;
  onClose?: () => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setFicha(await loadFicha(companyId));
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar a ficha."));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(name: string, fn: () => Promise<void>) {
    try {
      setBusy(name);
      setError("");
      await fn();
      await load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir."));
    } finally {
      setBusy("");
    }
  }

  if (!ficha) return <ErrorMessage message={error} />;

  const groups = ["Contato", "Redes sociais", "Dados da empresa"] as const;

  function decide(f: StoredFinding, decision: "ACCEPTED" | "REJECTED") {
    const force =
      decision === "ACCEPTED" &&
      !f.verified &&
      window.confirm(
        "A página citada não confirmou este dado. Aceitar mesmo assim? Confira o link antes.",
      );

    if (decision === "ACCEPTED" && !f.verified && !force) return;

    void run(`f${f.id}`, () => decideFinding(f.id, decision, { force }));
  }

  const renderFinding = (f: StoredFinding) => (
    <tr className="finding" key={f.id}>
      <td colSpan={5}>
        <div className="finding-box">
          <div>
            <strong>{f.value}</strong>{" "}
            <span className={f.verified ? "fs fs-ok" : "fs fs-partial"}>
              {f.verified ? "✓ Confirmado na página citada" : "◐ Não confirmado na página"}
            </span>
            <br />
            {f.evidence && <small className="muted">“{f.evidence}”</small>}
            <br />
            <button
              type="button"
              className="chip"
              onClick={() => void openExternal(f.source_url).catch(() => undefined)}
            >
              Abrir a página de origem
            </button>
          </div>

          <div className="outreach-actions">
            <button type="button" disabled={!!busy} onClick={() => decide(f, "ACCEPTED")}>
              Aceitar
            </button>
            <button type="button" className="secondary" disabled={!!busy} onClick={() => decide(f, "REJECTED")}>
              Rejeitar
            </button>
          </div>
        </div>
      </td>
    </tr>
  );

  const renderRow = (row: FichaRow) => (
    <Fragment key={row.key}>
      <tr>
        <th scope="row">{row.label}</th>
        <td>
          <StatusBadge status={row.status} />
        </td>
        <td>
          {row.value ?? <span className="muted">—</span>}
          {row.extras.length > 0 && <small className="muted"> + {row.extras.join(", ")}</small>}
        </td>
        <td>{row.source ?? <span className="muted">—</span>}</td>
        <td className="muted">{row.action ?? "Completo"}</td>
      </tr>
      {row.findings.map(renderFinding)}
    </Fragment>
  );

  return (
    <section className="panel ficha">
      <div className="panel-title">
        <div>
          <span className="eyebrow">FICHA DE ENRIQUECIMENTO</span>
          <h2>{ficha.company.name}</h2>
          <p className="muted">
            {ficha.completeness.ok} de {ficha.completeness.total} dados principais completos
          </p>
        </div>

        <div className="outreach-actions">
          <button
            type="button"
            disabled={!!busy || ficha.missing.length === 0}
            title={
              ficha.missing.length === 0
                ? "Não há dado faltando para buscar"
                : `A IA vai procurar: ${ficha.missing.join(", ")}`
            }
            onClick={() =>
              void run("search", async () => {
                const r = await searchCompanyWithAi(companyId);

                setMessage(
                  r.status === "NOTHING_MISSING"
                    ? "Nada faltando para buscar."
                    : r.found === 0
                      ? `A IA não encontrou nada confiável (${r.dropped} resposta(s) descartada(s) por falta de fonte). Nada foi inventado.`
                      : `${r.found} sugestão(ões) para você revisar (${r.verified} confirmada(s) na página citada).`,
                );
              })
            }
          >
            {busy === "search" ? "Buscando na web…" : "Buscar o que falta com a IA"}
          </button>

          {onClose && (
            <button type="button" className="secondary" onClick={onClose}>
              Fechar
            </button>
          )}
        </div>
      </div>

      <StatusLegend />
      {message && <p className="muted">{message}</p>}
      <ErrorMessage message={error} />

      {groups.map((group) => (
        <div key={group} className="ficha-group">
          <h3 className="group-title">{group}</h3>

          <table className="ficha-table">
            <thead>
              <tr>
                <th scope="col">Dado</th>
                <th scope="col">Situação</th>
                <th scope="col">Valor</th>
                <th scope="col">Fonte</th>
                <th scope="col">O que fazer</th>
              </tr>
            </thead>
            <tbody>{ficha.rows.filter((r) => r.group === group).map(renderRow)}</tbody>
          </table>
        </div>
      ))}

      <div className="ficha-group">
        <h3 className="group-title">O que melhorar no negócio (oportunidades)</h3>

        {ficha.improvements.length === 0 ? (
          <p className="muted">
            Ainda sem análise. Use "Enriquecer" com a análise do site (e o diagnóstico com IA) para
            listar as oportunidades.
          </p>
        ) : (
          <table className="ficha-table">
            <thead>
              <tr>
                <th scope="col">Origem</th>
                <th scope="col">Problema</th>
                <th scope="col">Evidência</th>
                <th scope="col">Oportunidade</th>
              </tr>
            </thead>
            <tbody>
              {ficha.improvements.map((i, idx) => (
                <tr key={`${i.title}-${idx}`}>
                  <td>{i.origin}</td>
                  <th scope="row">{i.title}</th>
                  <td className="muted">{i.evidence}</td>
                  <td>{i.suggestion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
