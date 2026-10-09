import { useCallback, useEffect, useMemo, useState } from "react";

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

  const refresh = useCallback(async () => {
    try {
      setItems(await listConversationSummaries());
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar conversas."));
    }
  }, []);

  useEffect(() => {
    void refresh();
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
              onClick={() => setFilter(key)}
            >
              {text}
            </button>
          ))}
        </div>

        <ErrorMessage message={error} />

        {visible.length === 0 ? (
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
      </section>

      <section className="conv-thread">
        {current ? (
          <ThreadView
            key={current.companyId}
            summary={current}
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
  onChanged,
  onOpenCompany,
}: {
  summary: ConversationSummary;
  onChanged: () => void;
  onOpenCompany: (id: number) => void;
}) {
  const companyId = summary.companyId;
  const [thread, setThread] = useState<Thread | null>(null);
  const [analysis, setAnalysis] = useState<StoredAnalysis | null>(null);
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [incoming, setIncoming] = useState("");
  const [manual, setManual] = useState("");
  const [draftText, setDraftText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, a, ch] = await Promise.all([
        loadThread(companyId),
        getLatestAnalysis(companyId),
        listChannelsRepository(companyId),
      ]);

      setThread(t);
      setAnalysis(a);
      setChannels(ch);
    } catch (err) {
      setError(errorMessage(err, "Erro ao carregar a conversa."));
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
      onChanged();
    } catch (err) {
      setError(errorMessage(err, "Não foi possível concluir a ação."));
    } finally {
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
  const whatsapp = main.find((c) => c.kind === "WHATSAPP") ?? main.find((c) => c.kind === "PHONE");
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
          <p className="error">
            Esta empresa pediu para não ser contatada (lista de supressão).
            Nenhuma mensagem será preparada.
          </p>
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
            value={draftText[draft.id] ?? draft.body}
            onChange={(e) => setDraftText({ ...draftText, [draft.id]: e.target.value })}
          />

          <div className="outreach-actions">
            {whatsapp && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  void openExternal(
                    channelOpenUrl(whatsapp, draftText[draft.id] ?? draft.body),
                  ).catch((e) => setError(errorMessage(e, "Erro ao abrir o WhatsApp.")))
                }
              >
                Abrir no WhatsApp
              </button>
            )}

            <button
              type="button"
              disabled={!!busy}
              onClick={() =>
                void run("approve", () =>
                  approveDraft(draft.id, draftText[draft.id] ?? draft.body),
                )
              }
            >
              Já enviei
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
