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

import { disqualifyCompany } from "../features/enrichment/enrichment.service";
import { enrichCompanyWithCnpj } from "../features/enrichment/cnpj.service";
import type { ScoreReason } from "../features/scoring/scoring.engine";

import {
  analyzeCompany,
  getLatestAnalysis,
} from "../features/ai/ai.service";
import type { StoredAnalysis } from "../features/ai/ai.service";
import { parseBottlenecks } from "../features/ai/ai.service";

import { label, LEAD_STATUS_LABEL, SCORE_DIMENSION_LABEL, SIGNAL_LABEL, SOURCE_LABEL, humanizeReason } from "../lib/labels";
import { createProspect } from "../features/prospects/prospect.service";

import { consolidateChannels } from "../features/contacts/consolidate";
import { ChannelButtons } from "../features/contacts/ChannelButtons";
import { isCompanySuppressed } from "../features/compliance/suppression.service";
import { listChannelsRepository } from "../features/contacts/channels.repository";
import type { StoredChannel } from "../features/contacts/channels.repository";
import { listApproachesRepository } from "../features/contacts/approaches.repository";
import type { StoredApproach } from "../features/contacts/approaches.repository";
import { channelOpenUrl, CHANNEL_LABEL } from "../features/contacts/channels.engine";
import type { ChannelKind } from "../features/contacts/channels.engine";

import { matchServices } from "../features/services/offers.engine";
import { listServices } from "../features/services/services.service";
import type { Service, ServiceKey } from "../features/services/services.service";
import { getLatestSnapshotRepository } from "../features/enrichment/enrichment.repository";

import { EnrichDialog } from "../features/enrichment/EnrichDialog";
import { ConfirmButton } from "../components/ConfirmButton";
import { openExternal } from "../lib/opener";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatPhone } from "../lib/format";

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
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [suppressed, setSuppressed] = useState(false);
  const [approaches, setApproaches] = useState<StoredApproach[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [matches, setMatches] = useState<ReturnType<typeof matchServices>>([]);
  const [enriching, setEnriching] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, s, sc, a, ch, ap, svc, facts] = await Promise.all([
        getCompanyRepository(companyId),
        listSignalsRepository(companyId),
        getLatestScoreRepository(companyId),
        getLatestAnalysis(companyId),
        listChannelsRepository(companyId),
        listApproachesRepository(companyId),
        listServices(true),
        getLatestSnapshotRepository(companyId),
      ]);
      setCompany(c);
      setSignals(s);
      setScore(sc);
      setAnalysis(a);
      setChannels(ch);
      setSuppressed(await isCompanySuppressed(companyId));
      setApproaches(ap);
      setServices(svc);
      setMatches(
        c
          ? matchServices({
              company: c,
              signals: s,
              facts,
              activeKeys: svc.map((x) => x.key as ServiceKey),
            })
          : [],
      );
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
          <span className="status">{label(LEAD_STATUS_LABEL, company.lead_status)}</span>
        </div>

        <div className="detail-grid">
          <span>Website: {company.website || "—"}</span>
          <span>Telefone: {company.phone ? formatPhone(company.phone) : "—"}</span>
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
          <button type="button" disabled={!!busy} onClick={() => setEnriching(true)}>
            Enriquecer…
          </button>

          <ConfirmButton
            secondary
            disabled={!!busy}
            warning="Usa a OpenAI (1 chamada, centavos). Continuar?"
            confirmLabel="Gerar plano com IA"
            onConfirm={() => void run("ai", () => analyzeCompany(companyId))}
          >
            {busy === "ai" ? "Gerando plano…" : "Gerar plano com IA"}
          </ConfirmButton>

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

      {enriching && (
        <EnrichDialog
          companyIds={[companyId]}
          onClose={() => setEnriching(false)}
          onStarted={() => {
            setEnriching(false);
            setError("");
            window.setTimeout(() => void load(), 4000);
          }}
        />
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>Contatos</h2>
        </div>

        <ChannelButtons
          channels={channels}
          message={
            (approaches.find((a) => a.channel === "WHATSAPP" && a.source === "AI") ??
              approaches.find((a) => a.channel === "WHATSAPP"))?.message
          }
          subject={`Contato — ${company.name}`}
          blocked={suppressed}
        />

        {channels.length > 0 && (() => {
          const { main, extra } = consolidateChannels(channels);
          const line = (ch: StoredChannel) => (
            <li key={ch.id}>
              <strong>{CHANNEL_LABEL[ch.kind]}</strong> —{" "}
              {ch.kind === "PHONE" || ch.kind === "WHATSAPP" ? formatPhone(ch.value) : ch.value}{" "}
              <small>
                ({ch.label ? `${ch.label}; ` : ""}fonte: {label(SOURCE_LABEL, ch.source)})
              </small>
            </li>
          );

          return (
            <>
              <ul className="reasons">{main.map(line)}</ul>

              {extra.length > 0 && (
                <details>
                  <summary className="muted">
                    Outros contatos encontrados ({extra.length})
                  </summary>
                  <ul className="reasons">{extra.map(line)}</ul>
                </details>
              )}
            </>
          );
        })()}

        {channels.length === 0 && (
          <p className="muted">
            Nenhum canal ainda. Use "Enriquecer…" para ler o site e coletar
            e-mails e redes sociais.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Como vender (serviços sugeridos)</h2>
        </div>

        {matches.length === 0 ? (
          <p className="muted">
            Sem evidência suficiente para sugerir um serviço. Rode
            "Enriquecer…" (com análise) ou gere o plano com IA.
          </p>
        ) : (
          <div className="tasks-list">
            {matches.map((m) => (
              <article className="task-item" key={m.key}>
                <div className="task-body">
                  <strong>
                    {services.find((s) => s.key === m.key)?.name ?? m.key}
                  </strong>
                  <ul className="reasons">
                    {m.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <span className="status">afinidade {m.score}</span>
              </article>
            ))}
          </div>
        )}

        {analysis?.recommended_services && (
          <>
            <h3 className="group-title">Sugestões da IA</h3>
            <ul className="reasons">
              {(JSON.parse(analysis.recommended_services) as { service_key: string; reason: string; pitch: string }[]).map(
                (r, i) => (
                  <li key={i}>
                    <strong>{services.find((s) => s.key === r.service_key)?.name ?? r.service_key}</strong>
                    {" — "}
                    {r.reason}
                    {r.pitch ? ` · Pitch: ${r.pitch}` : ""}
                  </li>
                ),
              )}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Abordagens ({approaches.length})</h2>
        </div>

        {approaches.length === 0 ? (
          <p className="muted">
            Nenhuma abordagem ainda. "Enriquecer…" gera modelos por canal sem
            IA; "Gerar plano com IA" cria versões personalizadas.
          </p>
        ) : (
          <div className="tasks-list">
            {approaches.map((ap) => {
              const channel = channels.find((c) => c.kind === ap.channel);

              return (
                <article className="task-item approach" key={ap.id}>
                  <div className="task-body">
                    <p>
                      <span className="status">{CHANNEL_LABEL[ap.channel as ChannelKind] ?? ap.channel}</span>{" "}
                      <span className="status">{ap.source === "AI" ? "IA" : "modelo"}</span>{" "}
                      <small>{ap.angle}</small>
                    </p>
                    <p className="script-body">{ap.message}</p>
                  </div>

                  <div className="task-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(ap.message);
                        setCopied(ap.id);
                      }}
                    >
                      {copied === ap.id ? "Copiado ✓" : "Copiar"}
                    </button>

                    {channel && (
                      <button
                        type="button"
                        onClick={() =>
                          void openExternal(
                            channelOpenUrl(channel, ap.message, `Contato — ${company.name}`),
                          )
                        }
                      >
                        Abrir no {CHANNEL_LABEL[channel.kind]}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Pontuação {score ? `${score.total}/100` : ""}</h2>
          {score && (
            <span className="counter">confiança {Math.round(score.confidence * 100)}%</span>
          )}
        </div>

        {!score ? (
          <div className="empty">Sem pontuação ainda. Use "Enriquecer…".</div>
        ) : (
          <>
            <p className="muted">
              Aderência {score.fit}/25 · Necessidade {score.need}/25 · Capacidade {score.capacity}/25 · Interesse {score.intent}/25
            </p>
            <ul className="reasons">
              {reasons.map((r, i) => (
                <li key={i}>
                  <strong>+{r.points}</strong> <small>{label(SCORE_DIMENSION_LABEL, r.dimension)}</small> — {humanizeReason(r.reason)}
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
                <strong>{label(SIGNAL_LABEL, s.type)}</strong> — {s.evidence}{" "}
                <small>({label(SOURCE_LABEL, s.source)}, confiança {Math.round(s.confidence * 100)}%)</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {analysis && parseBottlenecks(analysis).length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">DIAGNÓSTICO</span>
              <h2>Gargalos que a Creava resolve</h2>
            </div>
          </div>

          <div className="tasks-list">
            {parseBottlenecks(analysis).map((b) => (
              <article className="task-item" key={`${b.title}-${b.service_key}`}>
                <div className="task-body">
                  <strong>{b.title}</strong>
                  <p>{b.impact}</p>
                  <p className="muted">
                    Evidência: {b.evidence.map((e) => SIGNAL_LABEL[e] ?? e).join(", ")} · confiança{" "}
                    {Math.round(b.confidence * 100)}%
                  </p>
                </div>
                <div className="task-actions">
                  <span className="status">
                    {services.find((sv) => sv.key === b.service_key)?.name ?? b.service_key}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {analysis && (
        <section className="panel">
          <div className="panel-title">
            <h2>Análise da IA</h2>
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
