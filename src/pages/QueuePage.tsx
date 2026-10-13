import { useCallback, useEffect, useState } from "react";

import { channelOpenUrl } from "../features/contacts/channels.engine";
import {
  buildSendQueue,
  confirmQueueSent,
  hasOptOutLine,
  rewriteQueueMessage,
} from "../features/outreach/queue.service";
import type { QueueSummary } from "../features/outreach/queue.service";
import { skipTask } from "../features/workflow/workflow.service";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatPhone } from "../lib/format";
import { openExternal } from "../lib/opener";

export function QueuePage({
  onOpenCompany,
}: {
  onOpenCompany: (id: number) => void;
}) {
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setQueue(await buildSendQueue());
    } catch (err) {
      setError(errorMessage(err, "Erro ao montar a fila."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(taskId: number, fn: () => Promise<void>) {
    try {
      setBusy(taskId);
      setError("");
      await fn();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir."));
    } finally {
      setBusy(null);
    }
  }

  if (!queue) return <ErrorMessage message={error} />;

  const remaining = Math.max(queue.dailyLimit - queue.sentToday, 0);
  const full = remaining === 0;

  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">ENVIO ASSISTIDO</span>
            <h2>Fila de envio de hoje</h2>
          </div>

          <span className="counter">
            Enviadas hoje: {queue.sentToday} de {queue.dailyLimit}
          </span>
        </div>

        <p className="muted">
          A mensagem de cada empresa já vem pronta. Clique em <strong>Abrir no WhatsApp</strong>,
          envie por lá e depois confirme em <strong>Já enviei</strong>: só assim o envio entra no
          histórico e o retorno é agendado. O app nunca envia sozinho.
        </p>

        {!queue.businessHours && (
          <p className="warn-box">
            Fora do horário comercial (segunda a sábado, das 8h às 19h). Prefira enviar dentro dele.
          </p>
        )}

        {full && (
          <p className="warn-box">
            Você atingiu o limite diário. Ele protege o seu número; altere em Configurações só se for
            seguro.
          </p>
        )}

        {queue.suppressed > 0 && (
          <p className="muted">
            {queue.suppressed} empresa(s) ficaram de fora por estarem na lista de "não contatar".
          </p>
        )}

        <ErrorMessage message={error} />
      </section>

      {queue.items.length === 0 ? (
        <section className="panel">
          <div className="empty">
            Nenhuma mensagem na fila. Monte o dia em <strong>Hoje</strong> para trazer as empresas
            qualificadas.
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="tasks-list">
            {queue.items.map((item) => {
              const text = texts[item.taskId] ?? item.message;

              return (
                <article className="task-item queue-item" key={item.taskId}>
                  <div className="task-body">
                    <strong
                      className="clickable"
                      onClick={() => onOpenCompany(item.companyId)}
                    >
                      {item.companyName}
                    </strong>
                    <small className="muted">
                      {item.whatsapp.value.startsWith("msg/")
                        ? "Link do WhatsApp Business"
                        : formatPhone(item.whatsapp.value)}{" "}
                      · {item.source === "AI" ? "mensagem da IA" : "mensagem padrão"}
                      {item.whatsapp.label?.startsWith("provável") ? " · WhatsApp provável" : ""}
                    </small>

                    <textarea
                      rows={5}
                      aria-label={`Mensagem para ${item.companyName}`}
                      value={text}
                      onChange={(e) => setTexts({ ...texts, [item.taskId]: e.target.value })}
                    />

                    {!hasOptOutLine(text) && (
                      <small className="error-text">
                        Falta a opção de sair (“responda SAIR”). Recomendado em todo primeiro contato.
                      </small>
                    )}

                    {!item.canPrefill && (
                      <small className="muted">
                        Este link não aceita texto pronto: copie a mensagem acima e cole no WhatsApp.
                      </small>
                    )}
                  </div>

                  <div className="task-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setOpened(new Set(opened).add(item.taskId));
                        void openExternal(channelOpenUrl(item.whatsapp, text)).catch((e) =>
                          setError(errorMessage(e, "Erro ao abrir o WhatsApp.")),
                        );
                      }}
                    >
                      Abrir no WhatsApp
                    </button>

                    <button
                      type="button"
                      disabled={busy === item.taskId || full || !opened.has(item.taskId)}
                      title={opened.has(item.taskId) ? undefined : "Abra o WhatsApp primeiro"}
                      onClick={() =>
                        void run(item.taskId, async () => {
                          await confirmQueueSent(item.taskId, text);
                          await load();
                        })
                      }
                    >
                      Já enviei
                    </button>

                    <button
                      type="button"
                      className="secondary"
                      disabled={busy === item.taskId}
                      onClick={() =>
                        void run(item.taskId, async () => {
                          const rewritten = await rewriteQueueMessage(item.taskId);
                          setTexts({ ...texts, [item.taskId]: rewritten });
                        })
                      }
                    >
                      Reescrever com IA
                    </button>

                    <button
                      type="button"
                      className="secondary"
                      disabled={busy === item.taskId}
                      onClick={() =>
                        void run(item.taskId, async () => {
                          await skipTask(item.taskId);
                          await load();
                        })
                      }
                    >
                      Pular
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {queue.withoutWhatsapp.length > 0 && (
        <section className="panel">
          <div className="panel-title">
            <h2>Sem WhatsApp ({queue.withoutWhatsapp.length})</h2>
          </div>

          <p className="muted">
            Estas empresas não têm WhatsApp cadastrado. Ligue pelo "Dossiê e ligação" em Hoje ou
            abra a empresa para ver outros contatos.
          </p>

          <div className="chips">
            {queue.withoutWhatsapp.map((c) => (
              <button
                type="button"
                className="chip"
                key={c.taskId}
                onClick={() => onOpenCompany(c.companyId)}
              >
                {c.companyName}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
