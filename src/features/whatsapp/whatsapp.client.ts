import { getSupabase } from "../../lib/store";

export interface WhatsAppStatus {
  ok: boolean;
  configured: { token: boolean; phoneNumberId: boolean };
}

/** Lê a mensagem de erro que a função devolveu (corpo JSON da resposta). */
async function functionError(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: Response })?.context;

  if (context && typeof context.json === "function") {
    try {
      const body = (await context.json()) as { error?: string };

      if (body?.error) return body.error;
    } catch {
      // corpo não era JSON
    }
  }

  return (error as { message?: string })?.message ?? fallback;
}

/** O servidor está pronto para enviar? (nunca revela os segredos) */
export async function getWhatsAppStatus(): Promise<WhatsAppStatus | null> {
  try {
    const { data, error } = await getSupabase().functions.invoke("whatsapp-send", {
      body: { action: "ping" },
    });

    return error ? null : (data as WhatsAppStatus);
  } catch {
    return null;
  }
}

export const isWhatsAppReady = (s: WhatsAppStatus | null): boolean =>
  !!s?.ok && s.configured.token && s.configured.phoneNumberId;

/** Envia um texto pelo número oficial. A checagem de supressão fica no chamador. */
export async function sendWhatsAppText(
  to: string,
  text: string,
): Promise<{ wamid: string }> {
  const { data, error } = await getSupabase().functions.invoke("whatsapp-send", {
    body: { action: "send", to, text },
  });

  if (error) {
    throw new Error(await functionError(error, "Não foi possível enviar pelo WhatsApp."));
  }

  const result = data as { ok?: boolean; wamid?: string; error?: string };

  if (!result?.ok || !result.wamid) {
    throw new Error(result?.error ?? "Não foi possível enviar pelo WhatsApp.");
  }

  return { wamid: result.wamid };
}
