import {
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  listPendingTasks,
} from "../features/tasks/task.service";

import type {
  TaskWithProspect,
} from "../features/tasks/task.types";

import {
  markTaskAsSent,
  prepareAiOutreach,
  prepareOutreach,
} from "../features/outreach/outreach.service";

import {
  OutreachPanel,
} from "../features/outreach/OutreachPanel";

import type {
  OutreachDraft,
} from "../features/outreach/outreach.types";

import {
  completeTask,
  rescheduleTask,
  skipTask,
} from "../features/workflow/workflow.service";

import { label, TASK_TYPE_LABEL, PRIORITY_LABEL } from "../lib/labels";
import { STATUS_LABEL } from "../features/prospects/prospect.labels";
import type { ProspectStatus } from "../features/prospects/prospect.types";
import { ErrorMessage } from "../components/ErrorMessage";

function messageOf(
  err: unknown,
  fallback: string,
) {
  return err instanceof Error
    ? err.message
    : fallback;
}

interface Props {
  onOpenProspect: (id: number) => void;
}

export function TodayPage({ onOpenProspect }: Props) {
  const [tasks, setTasks] = useState<
    TaskWithProspect[]
  >([]);

  const [draft, setDraft] =
    useState<OutreachDraft | null>(null);

  const [error, setError] = useState("");

  const loadTasks = useCallback(async () => {
    try {
      setTasks(await listPendingTasks());
    } catch (err) {
      console.error(err);
      setError(
        messageOf(err, "Erro ao carregar tarefas."),
      );
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  async function handlePrepare(
    taskId: number,
  ) {
    try {
      setError("");
      setDraft(await prepareOutreach(taskId));
    } catch (err) {
      console.error(err);
      setError(
        messageOf(
          err,
          "Erro ao preparar abordagem.",
        ),
      );
    }
  }

  async function handleSent(
    taskId: number,
    message: string,
  ) {
    try {
      setError("");
      await markTaskAsSent(taskId, message);
      setDraft(null);
      await loadTasks();
    } catch (err) {
      console.error(err);
      setError(
        messageOf(
          err,
          "Erro ao registrar envio.",
        ),
      );
    }
  }

  async function act(action: () => Promise<void>) {
    try {
      setError("");
      await action();
      await loadTasks();
    } catch (err) {
      console.error(err);
      setError(messageOf(err, "Erro ao atualizar tarefa."));
    }
  }

  const overdue = tasks.filter((t) => t.is_overdue === 1);
  const today = tasks.filter((t) => t.is_overdue !== 1);

  function renderTask(task: TaskWithProspect) {
    const hasOutreach =
      task.type === "FIRST_CONTACT" ||
      task.type === "FOLLOW_UP";

    const isOpen = draft?.taskId === task.id;

    return (
      <article className="task-item" key={task.id}>
        <div className="task-body">
          <strong>{task.company_name}</strong>

          <p>
            {label(TASK_TYPE_LABEL, task.type)} · {task.title}
            {task.priority === "HIGH" ? ` · prioridade ${label(PRIORITY_LABEL, task.priority).toLowerCase()}` : ""}
          </p>

          {isOpen && draft && (
            <OutreachPanel
              key={task.id}
              draft={draft}
              onCancel={() => setDraft(null)}
              onGenerateAi={async () =>
                (await prepareAiOutreach(task.id)).message
              }
              onSent={(message) => handleSent(task.id, message)}
            />
          )}
        </div>

        <div className="task-actions">
          <span className="status">
            {STATUS_LABEL[task.prospect_status as ProspectStatus] ??
              task.prospect_status}
          </span>

          {hasOutreach && !isOpen && (
            <button type="button" onClick={() => void handlePrepare(task.id)}>
              Preparar abordagem
            </button>
          )}

          {!hasOutreach && (
            <button
              type="button"
              onClick={() => void act(() => completeTask(task.id))}
            >
              Concluir
            </button>
          )}

          <select
            value=""
            onChange={(e) =>
              void act(() =>
                rescheduleTask(task.id, Number(e.target.value)),
              )
            }
          >
            <option value="">Reagendar…</option>
            <option value="1">+1 dia</option>
            <option value="3">+3 dias</option>
            <option value="7">+7 dias</option>
          </select>

          <button
            type="button"
            className="secondary"
            onClick={() => void act(() => skipTask(task.id))}
          >
            Pular
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => onOpenProspect(task.prospect_id)}
          >
            Abrir
          </button>
        </div>
      </article>
    );
  }

  const firstContacts = tasks.filter((t) => t.type === "FIRST_CONTACT").length;
  const followUps = tasks.filter((t) => t.type === "FOLLOW_UP").length;

  return (
    <>
    <section className="metrics">
      <article className="metric-card">
        <span>Atrasadas</span>
        <strong className={overdue.length ? "danger-text" : undefined}>{overdue.length}</strong>
        <small>Precisam de atenção primeiro</small>
      </article>
      <article className="metric-card">
        <span>Para hoje</span>
        <strong>{today.length}</strong>
        <small>Tarefas do dia</small>
      </article>
      <article className="metric-card">
        <span>Primeiros contatos</span>
        <strong>{firstContacts}</strong>
        <small>Empresas esperando abordagem</small>
      </article>
      <article className="metric-card">
        <span>Retornos</span>
        <strong>{followUps}</strong>
        <small>Follow-ups a fazer</small>
      </article>
    </section>

    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">TAREFAS DO DIA</span>

          <h2>O que fazer agora</h2>
        </div>

        <span className="counter">
          {tasks.length} pendentes
        </span>
      </div>

      <ErrorMessage message={error} />

      {tasks.length === 0 ? (
        <div className="empty">
          Nenhuma ação pendente.
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <>
              <h3 className="group-title">
                Atrasadas ({overdue.length})
              </h3>
              <div className="tasks-list">
                {overdue.map(renderTask)}
              </div>
            </>
          )}

          {today.length > 0 && (
            <>
              <h3 className="group-title">
                Hoje ({today.length})
              </h3>
              <div className="tasks-list">
                {today.map(renderTask)}
              </div>
            </>
          )}
        </>
      )}
    </section>
    </>
  );
}
