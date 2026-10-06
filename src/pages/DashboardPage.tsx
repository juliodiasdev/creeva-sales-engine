import { useEffect, useState } from "react";

import { getDashboardMetrics } from "../features/dashboard/dashboard.service";
import type { DashboardMetrics } from "../features/dashboard/dashboard.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatCurrency } from "../lib/format";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function DashboardPage() {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDashboardMetrics()
      .then(setM)
      .catch((err) => setError(errorMessage(err, "Erro ao carregar métricas.")));
  }, []);

  if (!m) return <ErrorMessage message={error} />;

  const funnel: [string, number][] = [
    ["Empresas descobertas", m.companiesDiscovered],
    ["Qualificadas", m.companiesQualified],
    ["Prospects", m.prospects],
    ["Contatos enviados", m.contactsSent],
    ["Respostas", m.replies],
    ["Reuniões", m.meetings],
    ["Propostas", m.proposals],
    ["Ganhos", m.won],
  ];

  const max = Math.max(1, ...funnel.map(([, n]) => n));

  return (
    <>
      <section className="metrics">
        <Card label="Taxa de resposta" value={pct(m.replyRate)} />
        <Card label="Taxa de reunião" value={pct(m.meetingRate)} />
        <Card label="Taxa de fechamento" value={pct(m.closeRate)} />
        <Card label="Pipeline aberto" value={formatCurrency(m.pipelineValue)} />
        <Card label="Receita" value={formatCurrency(m.revenue)} />
        <Card label="Ticket médio" value={formatCurrency(m.averageTicket)} />
        <Card label="Perdidos" value={String(m.lost)} />
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Funil</h2>
        </div>

        <div className="funnel">
          {funnel.map(([label, n]) => (
            <div className="funnel-row" key={label}>
              <span>{label}</span>
              <div className="funnel-bar">
                <div style={{ width: `${(n / max) * 100}%` }} />
              </div>
              <strong>{n}</strong>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
