import {
  useState,
} from "react";

import type {
  OutreachDraft,
} from "./outreach.types";

interface Props {
  draft: OutreachDraft;

  onCancel: () => void;

  onSent: (
    message: string,
  ) => Promise<void>;

  /** Gera nova mensagem com IA (opcional). */
  onGenerateAi?: () => Promise<string>;
}

export function OutreachPanel({
  draft,
  onCancel,
  onSent,
  onGenerateAi,
}: Props) {
  const [message, setMessage] =
    useState(draft.message);

  const [copied, setCopied] =
    useState(false);

  const [sending, setSending] =
    useState(false);

  const [generating, setGenerating] =
    useState(false);

  const [aiError, setAiError] =
    useState("");

  async function handleGenerate() {
    if (!onGenerateAi) return;

    setGenerating(true);
    setAiError("");

    try {
      setMessage(await onGenerateAi());
      setCopied(false);
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : "Erro ao gerar com IA.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(
      message,
    );

    setCopied(true);
  }

  async function handleSent() {
    setSending(true);

    try {
      await onSent(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="outreach">
      <strong>
        Abordagem — {draft.companyName}
      </strong>

      <textarea
        rows={9}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
          setCopied(false);
        }}
      />

      <div className="outreach-actions">
        <button
          type="button"
          onClick={() => void handleCopy()}
        >
          {copied ? "Copiado ✓" : "Copiar"}
        </button>

        <button
          type="button"
          disabled={sending}
          onClick={() => void handleSent()}
        >
          {sending
            ? "Registrando..."
            : "Marcar como enviado"}
        </button>

        {onGenerateAi && (
          <button
            type="button"
            className="secondary"
            disabled={generating}
            onClick={() => void handleGenerate()}
          >
            {generating ? "Gerando..." : "Gerar com IA"}
          </button>
        )}

        <button
          type="button"
          className="secondary"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>

      {aiError && <p className="error">{aiError}</p>}

      <small>
        Envie manualmente (WhatsApp, e-mail ou DM) e
        depois marque como enviado.
      </small>
    </div>
  );
}
