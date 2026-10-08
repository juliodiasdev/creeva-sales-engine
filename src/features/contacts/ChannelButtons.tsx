import { useState } from "react";

import { CHANNEL_LABEL, channelOpenUrl } from "./channels.engine";
import type { ChannelKind } from "./channels.engine";
import type { StoredChannel } from "./channels.repository";

import { openExternal } from "../../lib/opener";
import { formatPhone } from "../../lib/format";

const ORDER: ChannelKind[] = [
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "EMAIL",
  "PHONE",
  "YOUTUBE",
  "TIKTOK",
  "WEBSITE",
];

/** Um botão por canal: abre no app certo (WhatsApp, rede social, e-mail...). */
export function ChannelButtons({
  channels,
  message,
  subject,
  size = "normal",
}: {
  channels: StoredChannel[];
  /** Mensagem pronta (WhatsApp e e-mail abrem já preenchidos). */
  message?: string;
  subject?: string;
  size?: "normal" | "small";
}) {
  const [error, setError] = useState("");

  if (channels.length === 0) {
    return <span className="muted">Sem canais de contato</span>;
  }

  const sorted = [...channels].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );

  return (
    <span className="channel-buttons">
      {sorted.map((ch) => (
        <button
          key={ch.id}
          type="button"
          className={`channel ${ch.kind.toLowerCase()} ${size === "small" ? "small" : ""}`}
          title={`${CHANNEL_LABEL[ch.kind]}: ${ch.kind === "PHONE" || ch.kind === "WHATSAPP" ? formatPhone(ch.value) : ch.value}${ch.label ? ` (${ch.label})` : ""}`}
          onClick={() =>
            void openExternal(channelOpenUrl(ch, message, subject)).catch(
              (e) => setError(e instanceof Error ? e.message : "Erro ao abrir."),
            )
          }
        >
          {CHANNEL_LABEL[ch.kind]}
          {ch.kind === "WHATSAPP" && ch.label?.startsWith("provável") ? "?" : ""}
        </button>
      ))}

      {error && <small className="error-text">{error}</small>}
    </span>
  );
}
