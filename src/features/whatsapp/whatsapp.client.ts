import { getSupabase } from "../../lib/store";

export interface WhatsAppStatus {
  ok: boolean;
  configured: { token: boolean; phoneNumberId: boolean };
}

/**
 * Estado da conexão, com o motivo certo quando algo está errado:
 *  ready · missing_secrets · not_installed · unauthorized · network · error
 */
export type WhatsAppCheck =
  | { kind: "ready" }
  | { kind: "missing_secrets"; missing: string[] }
  | { kind: "not_installed" | "unauthorized" | "network" | "error"; message: string };

/** Texto em português para qualquer erro ao chamar a função (nunca "non-2xx status code"). */
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

  const status = (context as { status?: number } | undefined)?.status;

  if (status === 401 || status === 403) {
    return "Sessão expirada ou sem permissão. Saia e entre de novo no app.";
  }

  if (status === 404) {
    return "A função whatsapp-send não está instalada no Supabase. Siga o passo a passo em Configurações → Conectar o WhatsApp.";
  }

  if (status && status >= 500) {
    return "O servidor do WhatsApp falhou. Confira os segredos da função no Supabase e tente de novo.";
  }

  const name = (error as { name?: string })?.name ?? "";

  if (/FetchError|Relay/i.test(name) || !context) {
    return "Não foi possível falar com o Supabase. Verifique a internet e tente de novo.";
  }

  return fallback;
}

/** Diagnostica a conexão com o servidor de envio. */
export async function checkWhatsApp(): Promise<WhatsAppCheck> {
  try {
    const { data, error } = await getSupabase().functions.invoke("whatsapp-send", {
      body: { action: "ping" },
    });

    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      const message = await functionError(error, "Erro ao verificar a conexão.");

      return {
        kind:
          status === 404
            ? "not_installed"
            : status === 401 || status === 403
              ? "unauthorized"
              : status === undefined
                ? "network"
                : "error",
        message,
      };
    }

    const status = data as WhatsAppStatus;
    const missing = [
      !status?.configured?.token && "WHATSAPP_TOKEN",
      !status?.configured?.phoneNumberId && "WHATSAPP_PHONE_NUMBER_ID",
    ].filter(Boolean) as string[];

    return status?.ok && missing.length === 0
      ? { kind: "ready" }
      : { kind: "missing_secrets", missing };
  } catch (err) {
    return { kind: "network", message: err instanceof Error ? err.message : "Falha de rede." };
  }
}

export const isWhatsAppReady = (c: WhatsAppCheck | null): boolean => c?.kind === "ready";

/** Compatível com quem só precisa saber se está pronto. */
export async function getWhatsAppStatus(): Promise<WhatsAppCheck> {
  return checkWhatsApp();
}

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
