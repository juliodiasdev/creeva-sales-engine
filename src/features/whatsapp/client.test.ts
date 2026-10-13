import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("../../lib/store", () => ({
  getSupabase: () => ({ functions: { invoke } }),
}));

import { checkWhatsApp, isWhatsAppReady, sendWhatsAppText } from "./whatsapp.client";

const httpError = (status: number, body?: unknown) => ({
  name: "FunctionsHttpError",
  message: "Edge Function returned a non-2xx status code",
  context: { status, json: async () => { if (body === undefined) throw new Error("sem corpo"); return body; } },
});

beforeEach(() => invoke.mockReset());

describe("diagnóstico da conexão", () => {
  it("diz o motivo certo em cada situação, sempre em português", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, configured: { token: true, phoneNumberId: true } }, error: null });
    expect(await checkWhatsApp()).toEqual({ kind: "ready" });

    invoke.mockResolvedValueOnce({ data: { ok: true, configured: { token: false, phoneNumberId: true } }, error: null });
    expect(await checkWhatsApp()).toEqual({ kind: "missing_secrets", missing: ["WHATSAPP_TOKEN"] });

    invoke.mockResolvedValueOnce({ data: null, error: httpError(404) });
    expect(await checkWhatsApp()).toMatchObject({ kind: "not_installed", message: expect.stringMatching(/não está instalada/) });

    invoke.mockResolvedValueOnce({ data: null, error: httpError(401) });
    expect(await checkWhatsApp()).toMatchObject({ kind: "unauthorized", message: expect.stringMatching(/Saia e entre/) });

    invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" } });
    expect(await checkWhatsApp()).toMatchObject({ kind: "network", message: expect.stringMatching(/internet/) });

    invoke.mockResolvedValueOnce({ data: null, error: httpError(500) });
    expect(await checkWhatsApp()).toMatchObject({ kind: "error", message: expect.stringMatching(/servidor do WhatsApp falhou/) });

    expect(isWhatsAppReady({ kind: "ready" })).toBe(true);
    expect(isWhatsAppReady({ kind: "network", message: "x" })).toBe(false);
  });
});

describe("envio", () => {
  it("devolve o texto de erro da função e nunca a frase em inglês", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: httpError(502, { error: "Fora da janela de 24 horas." }) });
    await expect(sendWhatsAppText("5565999991111", "oi")).rejects.toThrow("Fora da janela de 24 horas.");

    invoke.mockResolvedValueOnce({ data: null, error: httpError(500) });
    await expect(sendWhatsAppText("5565999991111", "oi")).rejects.not.toThrow(/non-2xx/);

    invoke.mockResolvedValueOnce({ data: { ok: true, wamid: "wamid.1" }, error: null });
    await expect(sendWhatsAppText("5565999991111", "oi")).resolves.toEqual({ wamid: "wamid.1" });
  });
});
