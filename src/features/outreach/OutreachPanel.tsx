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
}

export function OutreachPanel({
  draft,
  onCancel,
  onSent,
}: Props) {
  const [message, setMessage] =
    useState(draft.message);

  const [copied, setCopied] =
    useState(false);

  const [sending, setSending] =
    useState(false);

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

        <button
          type="button"
          className="secondary"
          onClick={onCancel}
        >
          Cancelar
        </button>
      </div>

      <small>
        Envie manualmente (WhatsApp, e-mail ou DM) e
        depois marque como enviado.
      </small>
    </div>
  );
}
