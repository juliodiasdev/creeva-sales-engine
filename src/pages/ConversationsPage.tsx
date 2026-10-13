import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  approveDraft,
  discardDraft,
  draftReply,
} from "../features/agent/agent.service";
import {
  confirmOptOut,
  listConversationSummaries,
  loadThread,
  logOutgoingMessage,
  recordIncomingMessage,
  restoreContact,
} from "../features/agent/conversation.service";
import type {
  ConversationSummary,
  Thread,
} from "../features/agent/conversation.service";
import { getLatestAnalysis, parseBottlenecks } from "../features/ai/ai.service";
import type { StoredAnalysis } from "../features/ai/ai.service";
import { channelOpenUrl } from "../features/contacts/channels.engine";
import { consolidateChannels } from "../features/contacts/consolidate";
import { listChannelsRepository } from "../features/contacts/channels.repository";
import type { StoredChannel } from "../features/contacts/channels.repository";
import {
  countFailedMessages,
  dismissDeliveryFailure,
  dismissUnknownMessage,
  listDeliveryFailures,
  listUnknownMessages,
  retryFailedMessages,
  suppressUnknownMessage,
  syncWhatsAppInbox,
} from "../features/whatsapp/inbox.service";
import type { DeliveryFailure, UnknownMessage } from "../features/whatsapp/inbox.service";
import { describeSendTarget, sendDraftViaWhatsApp } from "../features/whatsapp/send.service";
import { getWhatsAppStatus, isWhatsAppReady } from "../features/whatsapp/whatsapp.client";
import { STATUS_LABEL } from "../features/prospects/prospect.labels";

import { ErrorMessage } from "../components/ErrorMessage";
import { errorMessage, formatDateTime } from "../lib/format";
import { SIGNAL_LABEL } from "../lib/labels";
import { openExternal } from "../lib/opener";

type Filter = "ALL" | "AWAITING" | "DRAFT";

const INTENT_LABEL: Record<string, string> = {
  CONTINUE: "Continuar a conversa",
  BOOK_MEETING: "Propor reunião",
  HANDOFF: "Assumir você mesmo",
  CLOSE: "Encerrar com educação",
};

export function ConversationsPage({
  onOpenCompany,
}: {
  onOpenCompany: (id: number) => void;
}) {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  // Textos em edição ficam aqui: não se perdem ao trocar de conversa.
  const [texts, setTexts] = useState<Record<string, string>>({});
  const setText = useCallback(
    (key: string, value: string) => setTexts((t) => ({ ...t, [key]: value })),
    [],
  );

  const refresh = useCallback(async () => {
    try {
      setError("");
      setItems(await listConversationSummaries());
      setLoaded(true);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar conversas."));
    }
  }, []);

  const [waReady, setWaReady] = useState(false);
  const [unknown, setUnknown] = useState<UnknownMessage[]>([]);
  const [failed, setFailed] = useState(0);
  const [deliveryFailures, setDeliveryFailures] = useState<DeliveryFailure[]>([]);
  // Sobe quando chegam mensagens novas: a conversa aberta recarrega sozinha.
  const [syncTick, setSyncTick] = useState(0);

  // Traz as respostas recebidas pelo WhatsApp oficial (a cada minuto com a tela aberta).
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const result = await syncWhatsAppInbox();

        if (result.imported > 0) setSyncTick((t) => t + 1);

        setUnknown(await listUnknownMessages());
        setFailed(await countFailedMessages());
        setDeliveryFailures(await listDeliveryFailures());
      } catch {
        // sem WhatsApp configurado: nada a sincronizar
      }

      // Falha passageira ao consultar o estado não esconde o botão de envio para sempre.
      if (!cancelled) {
        void getWhatsAppStatus().then((st) => !cancelled && setWaReady(isWhatsAppReady(st)));
      }

      if (!cancelled) await refresh();
    }

    void tick();

    const timer = setInterval(() => void tick(), 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh]);

  const visible = useMemo(
    () =>
      items.filter((i) =>
        filter === "AWAITING" ? i.awaitingReply : filter === "DRAFT" ? i.hasDraft : true,
      ),
    [items, filter],
  );

  const awaiting = items.filter((i) => i.awaitingReply).length;
  const current = items.find((i) => i.companyId === selected) ?? null;

  return (
    <div className="conv-layout">
      <section className="panel conv-list">
        <div className="panel-title">
          <div>
            <span className="eyebrow">HISTÓRICO POR EMPRESA</span>
            <h2>Conversas</h2>
          </div>
        </div>

        <div className="chips">
          {(
            [
              ["ALL", `Todas (${items.length})`],
              ["AWAITING", `Aguardando você (${awaiting})`],
              ["DRAFT", "Com rascunho"],
            ] as [Filter, string][]
          ).map(([key, text]) => (
            <button
              type="button"
              key={key}
              className={filter === key ? "chip active" : "chip"}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {text}
            </button>
          ))}
        </div>

        <ErrorMessage message={error} />

        {!loaded && !error ? (
          <div className="empty">Carregando conversas…</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            {items.length === 0
              ? "Nenhuma empresa em abordagem ainda. Qualifique empresas em uma lista e inicie a abordagem."
              : "Nenhuma conversa neste filtro."}
          </div>
        ) : (
          <div className="conv-items">
            {visible.map((i) => (
              <button
                type="button"
                key={i.companyId}
                className={i.companyId === selected ? "conv-item active" : "conv-item"}
                aria-current={i.companyId === selected}
                onClick={() => setSelected(i.companyId)}
              >
                <strong>{i.companyName}</strong>
                <small>
                  {STATUS_LABEL[i.stage]}
                  {i.awaitingReply ? " · respondeu, aguardando você" : ""}
                  {i.hasDraft ? " · rascunho pronto" : ""}
                  {i.optedOut ? " · não contatar" : ""}
                </small>
                <small className="muted">
                  {i.lastBody ? i.lastBody.slice(0, 70) : "Sem mensagens ainda"}
                </small>
              </button>
            ))}
          </div>
        )}

        {failed > 0 && (
          <div className="warn-box">
            <strong>{failed} mensagem(ns) recebida(s) não puderam ser importadas.</strong>
            <div className="outreach-actions">
              <button
                type="button"
                onClick={() =>
                  void retryFailedMessages().then(async () => {
                    setFailed(await countFailedMessages());
                    void refresh();
                  })
                }
              >
                Tentar de novo
              </button>
            </div>
          </div>
        )}

        {deliveryFailures.length > 0 && (
          <div className="warn-box">
            <strong>Mensagens que o WhatsApp não entregou ({deliveryFailures.length})</strong>
            {deliveryFailures.map((d) => (
              <p key={d.id}>
                <small className="muted">+{d.phone}</small> {d.reason ?? "Falha na entrega."}{" "}
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    void dismissDeliveryFailure(d.id).then(async () =>
                      setDeliveryFailures(await listDeliveryFailures()),
                    )
                  }
                >
                  Dispensar
                </button>
              </p>
            ))}
          </div>
        )}

        {unknown.length > 0 && (
          <div className="warn-box">
            <strong>Mensagens fora da abordagem ({unknown.length})</strong>
            {unknown.map((u) => (
              <p key={u.id}>
                <small className="muted">
                  +{u.phone}
                  {u.name ? ` · ${u.name}` : ""}
                  {u.company_name ? ` · ${u.company_name} (ainda não está em abordagem)` : " · número sem empresa"}
                </small>
                <br />
                {u.body}{" "}
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    void dismissUnknownMessage(u.id).then(async () =>
                      setUnknown(await listUnknownMessages()),
                    )
                  }
                >
                  Dispensar
                </button>{" "}
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    void suppressUnknownMessage(u.id).then(async () =>
                      setUnknown(await listUnknownMessages()),
                    )
                  }
                >
                  Pediu para parar
                </button>
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="conv-thread">
        {current ? (
          <ThreadView
            key={current.companyId}
            summary={current}
            texts={texts}
            setText={setText}
            waReady={waReady}
            reloadKey={syncTick}
            onChanged={() => void refresh()}
            onOpenCompany={onOpenCompany}
          />
        ) : (
          <div className="panel">
            <div className="empty">
              Escolha uma empresa para ver o histórico, registrar a resposta
              do contato e gerar a próxima mensagem com o Claude.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ThreadView({
  summary,
  texts,
  setText,
  waReady,
  reloadKey,
  onChanged,
  onOpenCompany,
}: {
  waReady: boolean;
  reloadKey: number;
  summary: ConversationSummary;
  texts: Record<string, string>;
  setText: (key: string, value: string) => void;
  onChanged: () => void;
  onOpenCompany: (id: number) => void;
}) {
  const companyId = summary.companyId;
  const [thread, setThread] = useState<Thread | null>(null);
  const [analysis, setAnalysis] = useState<StoredAnalysis | null>(null);
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [target, setTarget] = useState<{ to: string | null; windowOpen: boolean } | null>(null);
  const incoming = texts[`incoming:${companyId}`] ?? "";
  const manual = texts[`manual:${companyId}`] ?? "";
  const setIncoming = (v: string) => setText(`incoming:${companyId}`, v);
  const setManual = (v: string) => setText(`manual:${companyId}`, v);
  const draftKey = (id: number) => `draft:${id}`;
  const [busy, setBusy] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const [t, a, ch, tg] = await Promise.all([
        loadThread(companyId),
        getLatestAnalysis(companyId),
        listChannelsRepository(companyId),
        describeSendTarget(companyId).catch(() => null),
      ]);

      setTarget(tg);
      setThread(t);
      setAnalysis(a);
      setChannels(ch);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar a conversa."));
    }
  }, [companyId]);

  // Recarrega quando chega mensagem nova (sync) ou quando o resumo da conversa muda.
  useEffect(() => {
    void load();
  }, [load, reloadKey, summary.lastAt, summary.messageCount]);

  const messageCount = thread?.messages.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messageCount]);

  async function run(name: string, fn: () => Promise<void>) {
    try {
      setBusy(name);
      setError("");
      await fn();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir a ação."));
    } finally {
      // Recarrega mesmo quando falhou: o rascunho pode já ter mudado.
      await load();
      onChanged();
      setBusy("");
    }
  }

  if (!thread) {
    return <div className="panel"><ErrorMessage message={error} /></div>;
  }

  const messages = thread.messages;
  const draft = [...messages].reverse().find((m) => m.status === "DRAFT");
  const sent = messages.filter((m) => m.status !== "DRAFT");
  const awaiting = sent.length > 0 && sent[sent.length - 1].direction === "IN";
  const bottlenecks = parseBottlenecks(analysis);
  const main = consolidateChannels(channels).main;
  const whatsapp = main.find((c) => c.kind === "WHATSAPP");
  const blocked = thread.suppressed;

  return (
    <>
      <div className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">{STATUS_LABEL[summary.stage].toUpperCase()}</span>
            <h2>{summary.companyName}</h2>
          </div>

          <button type="button" className="secondary" onClick={() => onOpenCompany(companyId)}>
            Abrir empresa
          </button>
        </div>

        {bottlenecks.length > 0 ? (
          <p className="muted">
            <strong>Gargalos:</strong>{" "}
            {bottlenecks
              .map((b) => `${b.title} (${b.evidence.map((e) => SIGNAL_LABEL[e] ?? e).join(", ")})`)
              .join(" · ")}
          </p>
        ) : (
          <p className="muted">
            Sem diagnóstico ainda: abra a empresa e use "Gerar plano com IA"
            para o Claude conversar com base em dados reais.
          </p>
        )}

        {blocked && (
          <div className="warn-box">
            <strong>Esta empresa pediu para não ser contatada (lista de supressão).</strong>{" "}
            Nenhuma mensagem será preparada.
            <div className="outreach-actions">
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  void run("restore", async () => {
                    const { stillBlocked } = await restoreContact(companyId);

                    if (stillBlocked) {
                      throw new Error(
                        "Outro cadastro com o mesmo telefone, e-mail ou site continua na lista de supressão, então esta empresa segue bloqueada.",
                      );
                    }
                  })
                }
              >
                Foi engano: desfazer
              </button>
            </div>
          </div>
        )}

        {thread.optOutSuspected && !blocked && (
          <div className="warn-box">
            <strong>A última mensagem parece um pedido para parar.</strong>
            <div className="outreach-actions">
              <button
                type="button"
                disabled={!!busy}
                onClick={() => void run("optout", () => confirmOptOut(companyId))}
              >
                Confirmar: não contatar mais
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  void run("draft", async () => {
                    await draftReply(companyId, { ignoreOptOutWarning: true });
                  })
                }
              >
                Não é pedido de parada: gerar resposta
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel conv-messages">
        {messages.filter((m) => m.status !== "DRAFT").length === 0 ? (
          <div className="empty">
            Nenhuma mensagem registrada. As mensagens enviadas em "Hoje" e as
            respostas coladas aqui formam o histórico.
          </div>
        ) : (
          messages
            .filter((m) => m.status !== "DRAFT")
            .map((m) => (
              <div key={m.id} className={m.direction === "IN" ? "bubble in" : "bubble out"}>
                <small>
                  {m.direction === "IN" ? "Contato" : m.author === "AI" ? "Você (rascunho do Claude)" : "Você"}
                  {" · "}
                  {formatDateTime(m.created_at)}
                </small>
                <p>{m.body}</p>
              </div>
            ))
        )}
        <div ref={endRef} />
      </div>

      {draft && !blocked && (
        <div className="panel draft-box">
          <div className="panel-title">
            <div>
              <span className="eyebrow">RASCUNHO DO CLAUDE · REVISE ANTES DE ENVIAR</span>
              <h2>{INTENT_LABEL[draft.intent ?? "CONTINUE"]}</h2>
            </div>
          </div>

          {draft.intent === "HANDOFF" && thread.conversation?.handoff_reason && (
            <p className="warn-box">
              Assuma você mesmo: {thread.conversation.handoff_reason}
            </p>
          )}

          <textarea
            rows={5}
            value={texts[draftKey(draft.id)] ?? draft.body}
            aria-label="Rascunho da mensagem"
            onChange={(e) => setText(draftKey(draft.id), e.target.value)}
          />

          <p className="muted small">
            {!waReady
              ? "WhatsApp oficial não conectado: envie manualmente e use “Já enviei (por fora)”."
              : !target?.to
                ? "Esta empresa não tem WhatsApp cadastrado."
                : target.windowOpen
                  ? `O botão “Enviar pelo WhatsApp” envia para +${target.to}.`
                  : "Janela de 24 horas fechada: a pessoa não escreveu no WhatsApp oficial nas últimas 24h. Envie manualmente."}
          </p>

          <div className="outreach-actions">
            {whatsapp && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void openExternal(
                    channelOpenUrl(whatsapp, texts[draftKey(draft.id)] ?? draft.body),
                  ).catch((e) => setError(errorMessage(e, "Erro ao abrir o WhatsApp.")))
                }
              >
                Abrir no WhatsApp
              </button>
            )}

            {waReady && target?.windowOpen && target.to && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm(`Enviar esta mensagem agora para +${target.to} (${summary.companyName})?`)) return;

                  void run("send", async () => {
                    await sendDraftViaWhatsApp(draft.id, texts[draftKey(draft.id)] ?? draft.body);
                  });
                }}
              >
                {busy === "send" ? "Enviando…" : "Enviar pelo WhatsApp"}
              </button>
            )}

            <button
              type="button"
              className={waReady && target?.windowOpen ? "secondary" : undefined}
              disabled={!!busy}
              onClick={() =>
                void run("approve", () =>
                  approveDraft(draft.id, texts[draftKey(draft.id)] ?? draft.body),
                )
              }
            >
              Já enviei (por fora)
            </button>

            <button
              type="button"
              className="secondary"
              disabled={!!busy}
              onClick={() => void run("discard", () => discardDraft(draft.id))}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {!blocked && (
        <div className="panel">
          <div className="panel-title">
            <h2>Registrar resposta do contato</h2>
          </div>

          <textarea
            rows={3}
            value={incoming}
            onChange={(e) => setIncoming(e.target.value)}
            aria-label="Resposta do contato"
            placeholder="Cole aqui o que a pessoa respondeu no WhatsApp"
          />

          <div className="outreach-actions">
            <button
              type="button"
              disabled={!incoming.trim() || !!busy}
              onClick={() =>
                void run("incoming", async () => {
                  await recordIncomingMessage(companyId, incoming);
                  setIncoming("");
                })
              }
            >
              Registrar resposta
            </button>

            <button
              type="button"
              disabled={!awaiting || !!busy || thread.optOutSuspected}
              onClick={() =>
                void run("draft", async () => {
                  await draftReply(companyId);
                })
              }
            >
              {busy === "draft" ? "Claude está escrevendo…" : "Gerar resposta com o Claude"}
            </button>
          </div>

          <details>
            <summary className="muted">Registrar uma mensagem que enviei por fora</summary>
            <textarea
              rows={2}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              aria-label="Mensagem enviada por você"
              placeholder="Mensagem enviada por você"
            />
            <button
              type="button"
              className="secondary"
              disabled={!manual.trim() || !!busy}
              onClick={() =>
                void run("manual", async () => {
                  await logOutgoingMessage(companyId, manual);
                  setManual("");
                })
              }
            >
              Registrar no histórico
            </button>
          </details>
        </div>
      )}

      <ErrorMessage message={error} />
    </>
  );
}
