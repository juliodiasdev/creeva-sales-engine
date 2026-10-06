import {
  useCallback,
  useEffect,
  useState,
} from "react";

import type { FormEvent } from "react";

import { getProspect } from "../features/prospects/prospect.service";
import type { ProspectWithCompany } from "../features/prospects/prospect.types";
import {
  ACTIVITY_LABEL,
  ALL_STATUSES,
  STATUS_LABEL,
} from "../features/prospects/prospect.labels";

import { listActivitiesRepository } from "../features/activities/activity.repository";
import type { Activity } from "../features/activities/activity.types";

import { listTasksByProspectRepository } from "../features/tasks/task.repository";
import type { Task } from "../features/tasks/task.types";

import {
  listDealsRepository,
} from "../features/deals/deal.repository";
import type { Deal } from "../features/deals/deal.types";
import { LOST_REASONS } from "../features/deals/deal.types";
import type { LostReason } from "../features/deals/deal.types";

import {
  changeProspectStatus,
  markLost,
  markWon,
  recordMeeting,
  recordReply,
  sendProposal,
  GUARDED_STATUSES,
} from "../features/workflow/workflow.service";

import { ErrorMessage } from "../components/ErrorMessage";

import {
  errorMessage,
  formatCurrency,
  formatDateTime,
} from "../lib/format";

type Form =
  | "reply"
  | "meeting"
  | "proposal"
  | "won"
  | "lost"
  | null;

interface Props {
  prospectId: number;
  onBack: () => void;
}

export function ProspectDetailPage({
  prospectId,
  onBack,
}: Props) {
  const [prospect, setProspect] =
    useState<ProspectWithCompany | null>(null);

  const [activities, setActivities] =
    useState<Activity[]>([]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);

  const [form, setForm] = useState<Form>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, a, t, d] = await Promise.all([
        getProspect(prospectId),
        listActivitiesRepository(prospectId),
        listTasksByProspectRepository(prospectId),
        listDealsRepository(prospectId),
      ]);

      setProspect(p);
      setActivities(a);
      setTasks(t);
      setDeals(d);
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Erro ao carregar prospect."));
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    try {
      setError("");
      await action();
      setForm(null);
      await load();
    } catch (err) {
      console.error(err);
      setError(errorMessage(err, "Erro ao salvar."));
    }
  }

  async function handleStatusSelect(value: string) {
    const status = value as never;

    if (GUARDED_STATUSES.includes(status)) {
      setForm(
        ({
          MEETING: "meeting",
          PROPOSAL: "proposal",
          WON: "won",
          LOST: "lost",
        } as Record<string, Form>)[value] ?? null,
      );
      return;
    }

    await run(() => changeProspectStatus(prospectId, status));
  }

  if (!prospect) {
    return (
      <section className="panel">
        <button type="button" className="secondary" onClick={onBack}>
          ← Voltar
        </button>
        <ErrorMessage message={error} />
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <button type="button" className="secondary" onClick={onBack}>
              ← Voltar
            </button>

            <h2>{prospect.company_name}</h2>

            <p className="muted">
              {[prospect.segment, prospect.city, prospect.state]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>

          <span className="status">
            {STATUS_LABEL[prospect.status]}
          </span>
        </div>

        <div className="detail-grid">
          <span>Website: {prospect.website || "—"}</span>
          <span>Telefone: {prospect.phone || "—"}</span>
          <span>Instagram: {prospect.instagram || "—"}</span>
          <span>Prioridade: {prospect.priority}</span>
          <span>Score: {prospect.score}</span>
          <span>
            Próxima ação: {prospect.next_action || "—"}{" "}
            {prospect.next_action_at
              ? `(${formatDateTime(prospect.next_action_at)})`
              : ""}
          </span>
          {prospect.lost_reason && (
            <span>Motivo da perda: {prospect.lost_reason}</span>
          )}
          <span>Notas: {prospect.qualification_notes || "—"}</span>
        </div>

        <ErrorMessage message={error} />

        <div className="outreach-actions">
          <button type="button" onClick={() => setForm("reply")}>
            Registrar resposta
          </button>
          <button type="button" onClick={() => setForm("meeting")}>
            Registrar reunião
          </button>
          <button type="button" onClick={() => setForm("proposal")}>
            Enviar proposta
          </button>
          <button type="button" onClick={() => setForm("won")}>
            Ganho
          </button>
          <button type="button" onClick={() => setForm("lost")}>
            Perdido
          </button>

          <select
            value=""
            onChange={(e) => void handleStatusSelect(e.target.value)}
          >
            <option value="">Mudar estágio…</option>
            {ALL_STATUSES.filter((s) => s !== prospect.status).map(
              (s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ),
            )}
          </select>
        </div>

        {form && (
          <ActionForm
            kind={form}
            onCancel={() => setForm(null)}
            onSubmit={(fn) => run(() => fn(prospectId))}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-title">
          <h2>Tarefas</h2>
        </div>

        {tasks.length === 0 ? (
          <div className="empty">Nenhuma tarefa.</div>
        ) : (
          <div className="tasks-list">
            {tasks.map((t) => (
              <article className="task-item" key={t.id}>
                <div className="task-body">
                  <strong>{t.title}</strong>
                  <p>
                    {t.type} · vence {formatDateTime(t.due_at)}
                  </p>
                </div>
                <span className="status">
                  {t.completed_at ? (t.outcome ?? "DONE") : "ABERTA"}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>

      {deals.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <h2>Negócios</h2>
          </div>

          <div className="tasks-list">
            {deals.map((d) => (
              <article className="task-item" key={d.id}>
                <div className="task-body">
                  <strong>{d.title}</strong>
                  <p>{formatCurrency(d.value)}</p>
                </div>
                <span className="status">{d.status}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-title">
          <h2>Timeline</h2>
        </div>

        <ol className="timeline">
          {activities.map((a) => (
            <li key={a.id}>
              <strong>
                {ACTIVITY_LABEL[a.type] ?? a.type}
              </strong>{" "}
              <small>{formatDateTime(a.occurred_at)}</small>
              {a.content && <p>{a.content}</p>}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

/* ---------- formulários ---------- */

type Submit = (
  fn: (prospectId: number) => Promise<void>,
) => Promise<void>;

function ActionForm({
  kind,
  onCancel,
  onSubmit,
}: {
  kind: Exclude<Form, null>;
  onCancel: () => void;
  onSubmit: Submit;
}) {
  const [text, setText] = useState("");
  const [value, setValue] = useState("");
  const [service, setService] = useState("");
  const [date, setDate] = useState("");
  const [need, setNeed] = useState("");
  const [budget, setBudget] = useState("");
  const [decision, setDecision] = useState("");
  const [timeline, setTimeline] = useState("");
  const [validDays, setValidDays] = useState("7");
  const [recurring, setRecurring] = useState(false);
  const [reason, setReason] = useState<LostReason>("PRICE");

  const amount = Number(value.replace(",", "."));

  function handle(event: FormEvent) {
    event.preventDefault();

    void onSubmit((id) => {
      switch (kind) {
        case "reply":
          return recordReply(id, text);
        case "meeting":
          return recordMeeting(id, {
            scheduledAt: date.replace("T", " "),
            notes: text || undefined,
            need: need || undefined,
            budget: budget || undefined,
            decisionMaker: decision || undefined,
            timeline: timeline || undefined,
          });
        case "proposal":
          return sendProposal(id, {
            value: amount,
            description: text || undefined,
            serviceType: service || undefined,
            validDays: Number(validDays) || undefined,
          });
        case "won":
          return markWon(id, {
            value: amount,
            serviceType: service || undefined,
            recurring,
          });
        case "lost":
          return markLost(id, reason, text || undefined);
      }
    });
  }

  return (
    <form className="outreach" onSubmit={handle}>
      {kind === "reply" && (
        <textarea
          rows={3}
          placeholder="O que o prospect respondeu?"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {kind === "meeting" && (
        <>
          <label>
            Data e hora
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <input placeholder="Necessidade" value={need} onChange={(e) => setNeed(e.target.value)} />
          <input placeholder="Orçamento" value={budget} onChange={(e) => setBudget(e.target.value)} />
          <input placeholder="Decisor" value={decision} onChange={(e) => setDecision(e.target.value)} />
          <input placeholder="Prazo" value={timeline} onChange={(e) => setTimeline(e.target.value)} />
          <textarea rows={3} placeholder="Observações" value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}

      {(kind === "proposal" || kind === "won") && (
        <>
          <input placeholder="Valor (R$)" value={value} onChange={(e) => setValue(e.target.value)} />
          <input placeholder="Serviço (ex.: Site, Tráfego)" value={service} onChange={(e) => setService(e.target.value)} />
        </>
      )}

      {kind === "proposal" && (
        <>
          <input placeholder="Validade (dias)" value={validDays} onChange={(e) => setValidDays(e.target.value)} />
          <textarea rows={3} placeholder="Descrição da proposta" value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}

      {kind === "won" && (
        <label>
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
          />{" "}
          Receita recorrente
        </label>
      )}

      {kind === "lost" && (
        <>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as LostReason)}
          >
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <textarea rows={2} placeholder="Observações (opcional)" value={text} onChange={(e) => setText(e.target.value)} />
        </>
      )}

      <div className="outreach-actions">
        <button type="submit">Salvar</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
