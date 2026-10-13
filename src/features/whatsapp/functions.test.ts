import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  handleRequest as webhook,
  messageText,
  parseWebhook,
  safeEqual,
  verifySignature,
} from "../../../supabase/functions/whatsapp-webhook/index";
import {
  describeMetaError,
  handleRequest as send,
  isLoggedInUser,
} from "../../../supabase/functions/whatsapp-send/index";

const SECRET = "app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "waba",
      changes: [
        {
          field: "messages",
          value: {
            contacts: [{ wa_id: "556592250342", profile: { name: "Dra. Regianne" } }],
            messages: [
              { id: "wamid.A", from: "556592250342", timestamp: "1760000000", type: "text", text: { body: "Oi! Como funciona?" } },
              { id: "wamid.B", from: "556592250342", timestamp: "1760000001", type: "audio", audio: { id: "x" } },
            ],
            statuses: [{ id: "wamid.OUT", status: "read", timestamp: "1760000002", recipient_id: "556592250342" }],
          },
        },
        { field: "account_update", value: { x: 1 } },
      ],
    },
  ],
};

const env = { verifyToken: "vt", appSecret: SECRET, supabaseUrl: "https://p.supabase.co", serviceKey: "svc" };

describe("assinatura e comparação", () => {
  it("aceita só a assinatura correta do corpo exato", async () => {
    const body = JSON.stringify(payload);

    expect(await verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(await verifySignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(await verifySignature(body, sign(body), "outro")).toBe(false);
    expect(await verifySignature(body, null, SECRET)).toBe(false);
    expect(await verifySignature(body, "sha1=abc", SECRET)).toBe(false);
    expect(await verifySignature(body, sign(body), "")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("parseWebhook", () => {
  it("extrai mensagens (com nome) e status; mídia vira aviso, nunca conteúdo inventado", () => {
    const events = parseWebhook(payload);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      wamid: "wamid.A", direction: "IN", status: "received", phone: "556592250342",
      name: "Dra. Regianne", body: "Oi! Como funciona?", eventAt: "2025-10-09T08:53:20.000Z",
    });
    expect(events[1].body).toMatch(/áudio recebido/);
    expect(events[2]).toMatchObject({ wamid: "wamid.OUT", direction: "STATUS", status: "read" });
  });

  it("reação e aviso do sistema não são resposta do contato", () => {
    const events = parseWebhook({
      entry: [{ changes: [{ field: "messages", value: { messages: [
        { id: "r1", from: "5565", type: "reaction", reaction: { emoji: "👍" } },
        { id: "r2", from: "5565", type: "system", system: { body: "mudou de número" } },
        { id: "r3", from: "5565", type: "text", text: { body: "Oi" } },
      ] } }] }],
    });

    expect(events.map((e) => e.wamid)).toEqual(["r3"]);
  });

  it("ignora payloads sem mensagens e formatos inesperados", () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: [{ changes: [{ field: "messages", value: {} }] }] })).toEqual([]);
    expect(parseWebhook({ entry: "x" })).toEqual([]);
    expect(messageText({ type: "interactive", interactive: { button_reply: { title: "Sim" } } })).toBe("Sim");
    expect(messageText({ type: "weird" })).toMatch(/abra no WhatsApp/);
  });
});

describe("webhook", () => {
  const get = (q: string) => new Request(`https://x/functions/v1/whatsapp-webhook?${q}`);

  it("verifica o endereço só com o token certo", async () => {
    const ok = await webhook(get("hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123"), env);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");

    expect((await webhook(get("hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1"), env)).status).toBe(403);
    expect((await webhook(get("hub.mode=subscribe&hub.challenge=1"), { ...env, verifyToken: "" })).status).toBe(403);
  });

  it("rejeita evento sem assinatura válida e não grava nada", async () => {
    const fetchImpl = vi.fn();
    const body = JSON.stringify(payload);

    const res = await webhook(
      new Request("https://x", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=00" } }),
      env,
      fetchImpl,
    );

    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("grava eventos assinados sem duplicar e usa a chave de serviço", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const body = JSON.stringify(payload);

    const res = await webhook(
      new Request("https://x", { method: "POST", body, headers: { "x-hub-signature-256": sign(body) } }),
      env,
      fetchImpl,
    );

    expect(res.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://p.supabase.co/rest/v1/whatsapp_events?on_conflict=wamid,direction,status");
    expect(init.headers.Prefer).toContain("ignore-duplicates");
    expect(init.headers.Authorization).toBe("Bearer svc");
    expect(JSON.parse(init.body)).toHaveLength(3);
  });

  it("falha de gravação devolve 500 para a Meta repetir; evento vazio devolve 200", async () => {
    const body = JSON.stringify(payload);
    const bad = vi.fn().mockResolvedValue(new Response("x", { status: 500 }));

    expect(
      (await webhook(new Request("https://x", { method: "POST", body, headers: { "x-hub-signature-256": sign(body) } }), env, bad)).status,
    ).toBe(500);

    const empty = JSON.stringify({ entry: [] });
    const never = vi.fn();

    expect(
      (await webhook(new Request("https://x", { method: "POST", body: empty, headers: { "x-hub-signature-256": sign(empty) } }), env, never)).status,
    ).toBe(200);
    expect(never).not.toHaveBeenCalled();
  });
});

describe("whatsapp-send", () => {
  const senv = {
    token: "tok", phoneNumberId: "123", apiVersion: "v22.0",
    supabaseUrl: "https://p.supabase.co", anonKey: "anon", serviceKey: "svc",
  };

  const call = (body: unknown, auth: string | null = "Bearer user-jwt") =>
    new Request("https://x", {
      method: "POST",
      body: JSON.stringify(body),
      headers: auth ? { authorization: auth } : {},
    });

  const user = (role = "authenticated", id: string | undefined = "u1") =>
    new Response(JSON.stringify({ id, role }), { status: 200 });

  it("a chave pública (anon) e requisições sem login não enviam", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));

    expect((await send(call({ action: "send", to: "5565999991111", text: "oi" }), senv, fetchImpl)).status).toBe(401);
    expect((await send(call({ action: "send" }, null), senv, fetchImpl)).status).toBe(401);
    expect(await isLoggedInUser("Bearer x", senv, vi.fn().mockResolvedValue(user("anon", undefined)))).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // só a checagem de login; nada foi para a Meta
  });

  it("ping informa só se está configurado, sem revelar segredos", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(user());
    const res = await send(call({ action: "ping" }), { ...senv, token: "" }, fetchImpl);
    const data = await res.json();

    expect(data).toEqual({ ok: true, configured: { token: false, phoneNumberId: true } });
    expect(JSON.stringify(data)).not.toContain("123");
  });

  it("envia texto pela Graph API com o token do servidor e registra o envio", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "wamid.NEW" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    const res = await send(call({ action: "send", to: "+55 (65) 99999-1111", text: "Olá!" }), senv, fetchImpl);

    expect(await res.json()).toEqual({ ok: true, wamid: "wamid.NEW" });

    const [url, init] = fetchImpl.mock.calls[1];
    expect(url).toBe("https://graph.facebook.com/v22.0/123/messages");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toMatchObject({ to: "5565999991111", type: "text", text: { body: "Olá!" } });

    const stored = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(stored).toMatchObject({ wamid: "wamid.NEW", direction: "OUT", status: "sent", processed: 1 });
  });

  it("valida destino e texto e traduz erros da Meta", async () => {
    const ok = () => vi.fn().mockResolvedValue(user());

    expect((await send(call({ action: "send", to: "123", text: "oi" }), senv, ok())).status).toBe(400);
    expect((await send(call({ action: "send", to: "5565999991111", text: "" }), senv, ok())).status).toBe(400);
    expect((await send(call({ action: "send", to: "5565999991111", text: "x".repeat(1001) }), senv, ok())).status).toBe(400);
    expect((await send(call({ action: "send", to: "5565999991111", text: "oi" }), { ...senv, token: "" }, ok())).status).toBe(503);

    const fail = vi
      .fn()
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement" } }), { status: 400 }));
    const res = await send(call({ action: "send", to: "5565999991111", text: "oi" }), senv, fail);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.error).toMatch(/24 horas/);
    expect(describeMetaError(190, "x")).toMatch(/Token/);
    expect(describeMetaError(100, "Unsupported post request", 33)).toMatch(/ID do número/);
    expect(parseWebhook({ entry: [{ changes: [{ field: "messages", value: { messages: [{ id: "v", from: "55", type: "video", video: { caption: "pare de mandar" } }] } }] }] })[0].body).toBe("[vídeo recebido: pare de mandar]");
    expect(describeMetaError(999, "boom")).toContain("999");
  });
});
