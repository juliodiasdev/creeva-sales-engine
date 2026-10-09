import { useEffect, useState } from "react";

import { getAnalysisSummary, getDashboardMetrics } from "../features/dashboard/dashboard.service";
import type { AnalysisSummary, DashboardMetrics } from "../features/dashboard/dashboard.service";
import { getLearningSummary } from "../features/agent/learning.service";
import type { LearningSummary } from "../features/agent/learning.service";
import { loadListsWithStats } from "../features/lists/lists.service";
import type { ListWithStats } from "../features/lists/lists.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatCurrency } from "../lib/format";
import { SIGNAL_LABEL } from "../lib/labels";
import { DEFAULT_SERVICES } from "../features/services/services.service";

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

export function DashboardPage() {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSummary | null>(null);
  const [learning, setLearning] = useState<LearningSummary | null>(null);
  const [lists, setLists] = useState<ListWithStats[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getDashboardMetrics(), loadListsWithStats(), getAnalysisSummary(), getLearningSummary()])
      .then(([metrics, l, a, lr]) => {
        setLearning(lr);
        setAnalysis(a);
        setM(metrics);
        setLists(l);
      })
      .catch((err) => setError(errorMessage(err, "Erro ao carregar métricas.")));
  }, []);

  if (!m) return <ErrorMessage message={error} />;

  const steps: { label: string; hint: string; n: number }[] = [
    { label: "Captadas", hint: "empresas vindas do Google Maps", n: m.companiesDiscovered },
    { label: "Enriquecidas", hint: "com dados do site/CNPJ", n: m.companiesEnriched },
    { label: "Qualificadas", hint: "aprovadas por você", n: m.companiesQualified },
    { label: "Em abordagem", hint: "viraram prospect", n: m.prospects },
    { label: "Contatadas", hint: "mensagem enviada", n: m.contactsSent },
    { label: "Responderam", hint: "retorno recebido", n: m.replies },
    { label: "Reuniões", hint: "reunião marcada/feita", n: m.meetings },
    { label: "Propostas", hint: "proposta enviada", n: m.proposals },
    { label: "Clientes", hint: "negócios ganhos", n: m.won },
  ];

  const max = Math.max(1, ...steps.map((s) => s.n));
  const empty = m.companiesDiscovered === 0;

  return (
    <>
      <section className="kpi-group">
        <h3 className="group-title">Prospecção</h3>
        <div className="metrics">
          <Card label="Empresas captadas" value={String(m.companiesDiscovered)} hint={`${m.companiesDiscarded} descartadas`} />
          <Card label="Em abordagem" value={String(m.prospects)} hint={`${m.contactsSent} já contatadas`} />
          <Card label="Taxa de resposta" value={pct(m.replyRate)} hint="respostas ÷ contatadas" />
          <Card label="Taxa de reunião" value={pct(m.meetingRate)} hint="reuniões ÷ contatadas" />
        </div>
      </section>

      <section className="kpi-group">
        <h3 className="group-title">Vendas</h3>
        <div className="metrics">
          <Card label="Pipeline aberto" value={formatCurrency(m.pipelineValue)} hint="negócios em andamento" />
          <Card label="Receita" value={formatCurrency(m.revenue)} hint={`${m.won} cliente(s) ganho(s)`} />
          <Card label="Ticket médio" value={formatCurrency(m.averageTicket)} hint="receita ÷ ganhos" />
          <Card label="Taxa de fechamento" value={pct(m.closeRate)} hint={`${m.lost} perdido(s)`} />
        </div>
      </section>

      {analysis && analysis.total > 0 && (
        <section className="panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">ANÁLISE DAS EMPRESAS</span>
              <h2>Funil de oportunidades</h2>
            </div>
          </div>

          <div className="funnel">
            {[
              ["Captadas do Google Maps", analysis.total],
              ["Analisadas (enriquecidas)", analysis.analyzed],
              [`Alta oportunidade (pontuação ≥ ${analysis.minScore})`, analysis.highOpportunity],
              ["Abaixo da pontuação mínima", analysis.belowMinimum],
            ].map(([label, n], i, all) => (
              <div className="funnel-row" key={String(label)}>
                <span>{label}</span>
                <div className="funnel-bar">
                  <div style={{ width: `${(Number(n) / Math.max(1, analysis.total)) * 100}%` }} />
                </div>
                <strong>{n}</strong>
                <em>
                  {i === 0 ? "—" : pct(Number(n) / Math.max(1, Number(all[i === 3 ? 1 : i - 1][1])))}
                </em>
              </div>
            ))}
          </div>

          {analysis.analyzed < analysis.total && (
            <p className="muted small">
              {analysis.total - analysis.analyzed} empresa(s) ainda não foram analisadas: abra a lista e use "Enriquecer".
            </p>
          )}

          {analysis.signals.length > 0 && (
            <>
              <h3 className="group-title">O que a análise encontrou (empresas por oportunidade)</h3>
              <div className="perf-table">
                {analysis.signals.map((sg) => (
                  <div className="perf-row sig-row" key={sg.type}>
                    <span>{SIGNAL_LABEL[sg.type] ?? sg.type}</span>
                    <strong>{sg.companies}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">DA LISTA AO CLIENTE</span>
            <h2>Funil completo</h2>
          </div>
        </div>

        {empty && (
          <div className="empty">
            Ainda não há dados. Crie uma lista em <strong>Listas</strong> para começar a medir.
          </div>
        )}

        <div className="funnel">
          {steps.map((step, i) => {
            const prev = i > 0 ? steps[i - 1].n : 0;

            return (
              <div className="funnel-row" key={step.label}>
                <span>
                  {step.label}
                  <small>{step.hint}</small>
                </span>
                <div className="funnel-bar">
                  <div style={{ width: `${(step.n / max) * 100}%` }} />
                </div>
                <strong>{step.n}</strong>
                <em>{i > 0 && prev > 0 ? pct(step.n / prev) : "—"}</em>
              </div>
            );
          })}
        </div>

        <p className="muted small">A porcentagem à direita é a conversão em relação à etapa anterior.</p>
      </section>

      {learning && learning.byService.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">O FUNIL APRENDE</span>
              <h2>Onde cada serviço converte</h2>
            </div>
          </div>

          <div className="perf-table">
            <div className="perf-row perf-head learn-row">
              <span>Serviço</span>
              <span>Em abordagem</span>
              <span>Contatadas</span>
              <span>Responderam</span>
              <span>Reuniões</span>
              <span>Ganhos</span>
            </div>

            {learning.byService.map((r) => (
              <div className="perf-row learn-row" key={r.serviceKey}>
                <strong>
                  {DEFAULT_SERVICES.find((s) => s.key === r.serviceKey)?.name ??
                    "Sem serviço definido"}
                </strong>
                <span>{r.prospects}</span>
                <span>{r.contacted}</span>
                <span>
                  {r.replied}
                  {r.contacted > 0 ? ` (${pct(r.replied / r.contacted)})` : ""}
                </span>
                <span>{r.meetings}</span>
                <span>{r.won}</span>
              </div>
            ))}
          </div>

          <p className="muted small">
            {learning.aiSent > 0
              ? `Rascunhos do Claude enviados: ${learning.aiSent}; você editou ${learning.aiEdited} (${pct(learning.aiEdited / learning.aiSent)}). Quanto menor a taxa de edição, mais o agente acerta o seu tom.`
              : "Ainda não há rascunhos do Claude enviados."}{" "}
            Com poucas conversas, as taxas variam muito: use como tendência, não como regra.
          </p>
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">POR LISTA</span>
            <h2>Desempenho de cada lista</h2>
          </div>
        </div>

        {lists.length === 0 ? (
          <div className="empty">Nenhuma lista criada ainda.</div>
        ) : (
          <div className="perf-table">
            <div className="perf-row perf-head">
              <span>Lista</span>
              <span>Empresas</span>
              <span>Enriquecidas</span>
              <span>Qualificadas</span>
              <span>Em abordagem</span>
              <span>Descartadas</span>
            </div>

            {lists.map(({ list, stats }) => (
              <div className="perf-row" key={list.id}>
                <strong>{list.name}</strong>
                <span>{stats.total}</span>
                <span>{stats.enriched}</span>
                <span>{stats.qualified}</span>
                <span>{stats.ready}</span>
                <span>{stats.disqualified}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}
