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
  prepareOutreach,
} from "../features/outreach/outreach.service";

import {
  OutreachPanel,
} from "../features/outreach/OutreachPanel";

import type {
  OutreachDraft,
} from "../features/outreach/outreach.types";

import { ErrorMessage } from "../components/ErrorMessage";

function messageOf(
  err: unknown,
  fallback: string,
) {
  return err instanceof Error
    ? err.message
    : fallback;
}

export function TodayPage() {
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

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">TODAY</span>

          <h2>Próximas ações</h2>
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
        <div className="tasks-list">
          {tasks.map((task) => {
            const hasOutreach =
              task.type === "FIRST_CONTACT" ||
              task.type === "FOLLOW_UP";

            const isOpen =
              draft?.taskId === task.id;

            return (
              <article
                className="task-item"
                key={task.id}
              >
                <div className="task-body">
                  <strong>
                    {task.company_name}
                  </strong>

                  <p>{task.title}</p>

                  {isOpen && draft && (
                    <OutreachPanel
                      key={task.id}
                      draft={draft}
                      onCancel={() =>
                        setDraft(null)
                      }
                      onSent={(message) =>
                        handleSent(
                          task.id,
                          message,
                        )
                      }
                    />
                  )}
                </div>

                <div className="task-actions">
                  {hasOutreach && !isOpen && (
                    <button
                      type="button"
                      onClick={() =>
                        void handlePrepare(
                          task.id,
                        )
                      }
                    >
                      Preparar abordagem
                    </button>
                  )}

                  <span className="status">
                    {task.prospect_status}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
