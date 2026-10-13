// Envia mensagens pelo WhatsApp oficial (Meta). O token da Meta fica SÓ aqui,
// nunca no app. Arquivo único, sem dependências: pode ser colado no editor de
// Edge Functions do Supabase. Deixe "Verify JWT" LIGADO.
//
// Segredos necessários (Edge Functions → Secrets):
//   WHATSAPP_TOKEN            token permanente do "usuário do sistema" (Meta)
//   WHATSAPP_PHONE_NUMBER_ID  ID do número de telefone (Meta)
//   WHATSAPP_API_VERSION      opcional (padrão v22.0)
// O Supabase já injeta SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

export interface SendEnv {
  token: string;
  phoneNumberId: string;
  apiVersion: string;
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
}

/** Traduz erros comuns da Meta em orientação em português. */
export function describeMetaError(code: number | undefined, message: string): string {
  if (code === 190) return "Token da Meta inválido ou expirado. Gere um token permanente do usuário do sistema.";
  if (code === 131047) return "Fora da janela de 24 horas: só é possível responder até 24h depois da última mensagem da pessoa (ou com um modelo aprovado).";
  if (code === 131030) return "Este número não está liberado como destinatário de teste na Meta.";
  if (code === 131026) return "A mensagem não pôde ser entregue (número sem WhatsApp ou bloqueado).";
  if (code === 130429 || code === 80007) return "Limite de envio da Meta atingido. Tente novamente mais tarde.";
  if (code === 131056) return "Muitas mensagens para o mesmo número em pouco tempo.";

  return `A Meta recusou o envio${code ? ` (código ${code})` : ""}: ${message}`;
}

/** Só quem está logado no app pode enviar: a chave pública (anon) não vale. */
export async function isLoggedInUser(
  authorization: string | null,
  env: SendEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!authorization?.startsWith("Bearer ")) return false;

  const res = await fetchImpl(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: authorization },
  });

  if (!res.ok) return false;

  const user = (await res.json()) as { id?: string; role?: string };

  return !!user?.id && user.role === "authenticated";
}

export async function handleRequest(
  req: Request,
  env: SendEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  if (!(await isLoggedInUser(req.headers.get("authorization"), env, fetchImpl))) {
    return json({ ok: false, error: "Faça login no app para enviar mensagens." }, 401);
  }

  let body: { action?: string; to?: string; text?: string };

  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Pedido inválido." }, 400);
  }

  // Estado da configuração (nunca devolve os valores dos segredos).
  if (body.action === "ping") {
    return json({
      ok: true,
      configured: { token: !!env.token, phoneNumberId: !!env.phoneNumberId },
    });
  }

  if (body.action !== "send") return json({ ok: false, error: "Ação desconhecida." }, 400);

  if (!env.token || !env.phoneNumberId) {
    return json({ ok: false, error: "WhatsApp ainda não configurado no servidor." }, 503);
  }

  const to = String(body.to ?? "").replace(/\D/g, "");
  const text = String(body.text ?? "").trim();

  if (to.length < 10 || to.length > 15) {
    return json({ ok: false, error: "Número de destino inválido." }, 400);
  }

  if (!text || text.length > 1000) {
    return json({ ok: false, error: "A mensagem deve ter de 1 a 1000 caracteres." }, 400);
  }

  const res = await fetchImpl(
    `https://graph.facebook.com/${env.apiVersion}/${env.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text, preview_url: false },
      }),
    },
  );

  const data = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { code?: number; message?: string };
  };

  if (!res.ok || !data.messages?.[0]?.id) {
    return json(
      { ok: false, error: describeMetaError(data.error?.code, data.error?.message ?? "erro desconhecido") },
      502,
    );
  }

  const wamid = data.messages[0].id;

  // Registra o envio (os status "entregue/lido" chegam depois pelo webhook).
  await fetchImpl(`${env.supabaseUrl}/rest/v1/whatsapp_events?on_conflict=wamid,direction,status`, {
    method: "POST",
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify({
      wamid,
      direction: "OUT",
      status: "sent",
      phone: to,
      body: text,
      processed: 1,
      event_at: new Date().toISOString(),
    }),
  }).catch(() => undefined);

  return json({ ok: true, wamid });
}

declare const Deno: any;

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) =>
    handleRequest(req, {
      token: Deno.env.get("WHATSAPP_TOKEN") ?? "",
      phoneNumberId: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "",
      apiVersion: Deno.env.get("WHATSAPP_API_VERSION") ?? "v22.0",
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      anonKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    }),
  );
}
