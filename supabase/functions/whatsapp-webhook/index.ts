// Recebe os eventos do WhatsApp oficial (Meta) e guarda em `whatsapp_events`.
// Arquivo único e sem dependências: pode ser colado no editor de Edge Functions
// do Supabase. Desligue "Verify JWT" desta função (a Meta não envia login);
// a segurança vem da assinatura HMAC (X-Hub-Signature-256) conferida abaixo.
//
// Segredos necessários (Edge Functions → Secrets):
//   WHATSAPP_VERIFY_TOKEN  texto que você inventa e informa também na Meta
//   META_APP_SECRET        "Chave secreta do app" (Configurações do app → Básico)
// O Supabase já injeta SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.

export interface WaEvent {
  wamid: string;
  direction: "IN" | "STATUS";
  status: string;
  phone: string | null;
  name: string | null;
  body: string | null;
  eventAt: string | null;
  raw: string;
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Comparação em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;

  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return diff === 0;
}

/** Confere o cabeçalho X-Hub-Signature-256 ("sha256=<hex>") do corpo bruto. */
export async function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const expected = toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );

  return safeEqual(expected, header.slice("sha256=".length).toLowerCase());
}

const iso = (ts: unknown): string | null => {
  const n = Number(ts);

  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

/** Texto da mensagem; mídia vira um aviso (nunca inventamos conteúdo). */
export function messageText(m: Record<string, any>): string {
  switch (m.type) {
    case "text":
      return String(m.text?.body ?? "");
    case "button":
      return String(m.button?.text ?? "[botão]");
    case "interactive":
      return String(
        m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          "[resposta interativa]",
      );
    case "audio":
      return "[áudio recebido: abra no WhatsApp para ouvir]";
    case "image":
      return `[imagem recebida${m.image?.caption ? `: ${m.image.caption}` : ""}]`;
    case "document":
      return "[documento recebido: abra no WhatsApp]";
    case "video":
      return "[vídeo recebido: abra no WhatsApp]";
    case "location":
      return "[localização recebida]";
    case "sticker":
      return "[figurinha recebida]";
    default:
      return `[mensagem do tipo "${String(m.type)}": abra no WhatsApp]`;
  }
}

/** Tipos que não são uma resposta do contato (reação, aviso do sistema...). */
const IGNORED_TYPES = new Set(["reaction", "system", "unsupported", "ephemeral", "request_welcome"]);

/** Extrai mensagens recebidas e atualizações de status do payload da Meta. */
export function parseWebhook(payload: any): WaEvent[] {
  const events: WaEvent[] = [];

  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "messages") continue;

      const value = change.value ?? {};
      const names = new Map<string, string>(
        (Array.isArray(value.contacts) ? value.contacts : []).map((c: any) => [
          String(c?.wa_id ?? ""),
          String(c?.profile?.name ?? ""),
        ]),
      );

      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m?.id || !m?.from || IGNORED_TYPES.has(String(m.type))) continue;

        events.push({
          wamid: String(m.id),
          direction: "IN",
          status: "received",
          phone: String(m.from).replace(/\D/g, ""),
          name: names.get(String(m.from)) || null,
          body: messageText(m),
          eventAt: iso(m.timestamp),
          raw: JSON.stringify(m),
        });
      }

      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s?.id || !s?.status) continue;

        events.push({
          wamid: String(s.id),
          direction: "STATUS",
          status: String(s.status),
          phone: s.recipient_id ? String(s.recipient_id).replace(/\D/g, "") : null,
          name: null,
          body: s.errors?.[0]?.title ? String(s.errors[0].title) : null,
          eventAt: iso(s.timestamp),
          raw: JSON.stringify(s),
        });
      }
    }
  }

  return events;
}

export interface WebhookEnv {
  verifyToken: string;
  appSecret: string;
  supabaseUrl: string;
  serviceKey: string;
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain" } });

/** Lógica completa do webhook (testável sem o Deno). */
export async function handleRequest(
  req: Request,
  env: WebhookEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);

  // 1) Verificação do endereço, feita uma vez pela Meta ao salvar o webhook.
  if (req.method === "GET") {
    const ok =
      url.searchParams.get("hub.mode") === "subscribe" &&
      !!env.verifyToken &&
      safeEqual(url.searchParams.get("hub.verify_token") ?? "", env.verifyToken);

    return ok ? text(url.searchParams.get("hub.challenge") ?? "") : text("forbidden", 403);
  }

  if (req.method !== "POST") return text("method not allowed", 405);

  // 2) Eventos: só aceita o que a Meta assinou com o segredo do app.
  const raw = await req.text();

  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), env.appSecret))) {
    return text("invalid signature", 401);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return text("bad json", 400);
  }

  const events = parseWebhook(payload);

  if (events.length === 0) return text("ok");

  // 3) Guarda sem duplicar (a Meta repete entregas): unique (wamid, direction, status).
  const response = await fetchImpl(
    `${env.supabaseUrl}/rest/v1/whatsapp_events?on_conflict=wamid,direction,status`,
    {
      method: "POST",
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(
        events.map((e) => ({
          wamid: e.wamid,
          direction: e.direction,
          status: e.status,
          phone: e.phone,
          name: e.name,
          body: e.body,
          raw: e.raw,
          event_at: e.eventAt,
        })),
      ),
    },
  );

  // Erro ao gravar: responde 500 para a Meta tentar de novo mais tarde.
  return response.ok ? text("ok") : text("storage error", 500);
}

declare const Deno: any;

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) =>
    handleRequest(req, {
      verifyToken: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "",
      appSecret: Deno.env.get("META_APP_SECRET") ?? "",
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    }),
  );
}
