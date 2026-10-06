import { useCallback, useEffect, useState } from "react";

import { getCompanyRepository } from "../features/companies/company.repository";
import type { Company } from "../features/companies/company.types";

import {
  getLatestScoreRepository,
  listSignalsRepository,
} from "../features/enrichment/enrichment.repository";
import type {
  StoredScore,
  StoredSignal,
} from "../features/enrichment/enrichment.repository";

import {
  disqualifyCompany,
  enrichCompany,
} from "../features/enrichment/enrichment.service";
import { enrichCompanyWithCnpj } from "../features/enrichment/cnpj.service";
import type { ScoreReason } from "../features/scoring/scoring.engine";

import {
  analyzeCompany,
  getLatestAnalysis,
} from "../features/ai/ai.service";
import type { StoredAnalysis } from "../features/ai/ai.service";

import { createProspect } from "../features/prospects/prospect.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage } from "../lib/format";

interface Props {
  companyId: number;
  onBack: () => void;
  onOpenProspect: (prospectId: number) => void;
}

export function CompanyDetailPage({ companyId, onBack, onOpenProspect }: Props) {
  const [company, setCompany] = useState<Company | null>(null);
  const [signals, setSignals] = useState<StoredSignal[]>([]);
  const [score, setScore] = useState<StoredScore | null>(null);
  const [analysis, setAnalysis] = useState<StoredAnalysis | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, s, sc, a] = await Promise.all([
        getCompanyRepository(companyId),
        listSignalsRepository(companyId),
        getLatestScoreRepository(companyId),
        getLatestAnalysis(companyId),
      ]);
      setCompany(c);
      setSignals(s);
      setScore(sc);
      setAnalysis(a);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar empresa."));
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, action: () => Promise<unknown>) {
    try {
      setError("");
      setBusy(label);
      await action();
      await load();
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Erro na operação."));
    } finally {
      setBusy("");
    }
  }

  if (!company) {
    return (
      <section className="panel">
        <button type="button" className="secondary" onClick={onBack}>← Voltar</button>
        <ErrorMessage message={error} />
      </section>
    );
  }

  const reasons: ScoreReason[] = score ? JSON.parse(score.reasons) : [];

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <button type="button" className="secondary" onClick={onBack}>← Voltar</button>
            <h2>{company.name}</h2>
            <p className="muted">
              {[company.segment, company.city, company.state].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <span className="status">{company.lead_status}</span>
        </div>

        <div className="detail-grid">
          <span>Website: {company.website || "—"}</span>
          <span>Telefone: {company.phone || "—"}</span>
          <span>Endereço: {company.address || "—"}</span>
          <span>Google: {company.rating ?? "—"} ({company.reviews_count ?? 0} avaliações)</span>
          <span>CNPJ: {company.cnpj || "—"}</span>
          <span>Razão social: {company.legal_name || "—"}</span>
          <span>CNAE: {company.cnae || "—"}</span>
          <span>Situação: {company.registration_status || "—"}</span>
          {company.disqualified_reason && (
            <span>Motivo da desqualificação: {company.disqualified_reason}</span>
          )}
        </div>

        <ErrorMessage message={error} />

        <div className="outreach-actions">
          <button type="button" disabled={!!busy} onClick={() => void run("enrich", () => enrichCompany(companyId))}>
            {busy === "enrich" ? "Enriquecendo..." : "Enriquecer (site + score)"}
          </button>

          <button type="button" disabled={!!busy} onClick={() => void run("ai", () => analyzeCompany(companyId))}>
            {busy === "ai" ? "Analisando..." : "Analisar com IA"}
          </button>

          {company.lead_status !== "READY" && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void run("prospect", async () => {
                  const id = await createProspect(companyId);
                  onOpenProspect(id);
                })
              }
            >
              Prospectar
            </button>
          )}
        </div>

        <div className="outreach-actions">
          <input
            placeholder="CNPJ (somente se você já souber)"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            disabled={!!busy || !cnpj}
            onClick={() => void run("cnpj", () => enrichCompanyWithCnpj(companyId, cnpj))}
          >
            Buscar dados do CNPJ
          </button>
        </div>

        {company.lead_status !== "DISQUALIFIED" && (
          <div className="outreach-actions">
            <input
              placeholder="Motivo para desqualificar"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              className="secondary"
              disabled={!!busy || !reason}
              onClick={() => void run("dq", () => disqualifyCompany(companyId, reason))}
            >
              Desqualificar
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Score {score ? `${score.total}/100` : ""}</h2>
          {score && (
            <span className="counter">confiança {Math.round(score.confidence * 100)}%</span>
          )}
        </div>

        {!score ? (
          <div className="empty">Sem score. Rode "Enriquecer".</div>
        ) : (
          <>
            <p className="muted">
              FIT {score.fit}/25 · NEED {score.need}/25 · CAPACITY {score.capacity}/25 · INTENT {score.intent}/25
            </p>
            <ul className="reasons">
              {reasons.map((r, i) => (
                <li key={i}>
                  <strong>+{r.points}</strong> <small>{r.dimension}</small> — {r.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Sinais ({signals.length})</h2>
        </div>

        {signals.length === 0 ? (
          <div className="empty">Nenhum sinal detectado.</div>
        ) : (
          <ul className="reasons">
            {signals.map((s) => (
              <li key={s.id}>
                <strong>{s.type}</strong> — {s.evidence}{" "}
                <small>({s.source}, confiança {Math.round(s.confidence * 100)}%)</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {analysis && (
        <section className="panel">
          <div className="panel-title">
            <h2>Análise IA</h2>
            <span className="counter">confiança {Math.round(analysis.confidence * 100)}%</span>
          </div>
          <div className="detail-grid">
            <span><strong>Resumo:</strong> {analysis.summary}</span>
            <span><strong>Problema:</strong> {analysis.main_problem}</span>
            <span><strong>Oportunidade:</strong> {analysis.opportunity}</span>
            <span><strong>Oferta:</strong> {analysis.recommended_offer}</span>
            <span><strong>Ângulo:</strong> {analysis.outreach_angle}</span>
          </div>
        </section>
      )}
    </>
  );
}
