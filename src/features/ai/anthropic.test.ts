import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});

const httpFetch = vi.fn();
vi.mock("../../lib/http", () => ({ httpFetch: (...a: unknown[]) => httpFetch(...a) }));

import { setSetting } from "../settings/settings.service";
import { claudeChatJson, parseJsonText, testClaudeConnection } from "./anthropic.client";

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const ok = (text: string, stop = "end_turn") =>
  res(200, { content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } });

beforeEach(async () => {
  await createMigratedTestDb();
  httpFetch.mockReset();
});

describe("parseJsonText", () => {
  it("aceita JSON puro, cercado e com texto em volta", () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('Claro! {"a":1} pronto')).toEqual({ a: 1 });
    expect(() => parseJsonText("sem json")).toThrow(/JSON/);
  });
});

describe("claude client", () => {
  it("exige a chave", async () => {
    await expect(testClaudeConnection()).rejects.toThrow(/chave/i);
  });

  it("envia a chave no cabeçalho certo e registra uso real", async () => {
    await setSetting("anthropic_api_key", "sk-ant-test");
    httpFetch.mockResolvedValue(ok('{"ok": true}'));

    await expect(testClaudeConnection()).resolves.toMatch(/Conexão OK/);

    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body)).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 4096 });
    expect(JSON.parse(init.body)).not.toHaveProperty("temperature");
  });

  it("nunca transforma resposta cortada ou recusa em rascunho", async () => {
    await setSetting("anthropic_api_key", "k");

    httpFetch.mockResolvedValueOnce(ok('{"message":"oi', "max_tokens"));
    await expect(claudeChatJson("s", [{ role: "user", content: "x" }])).rejects.toThrow(/cortada/);

    httpFetch.mockResolvedValueOnce(ok("", "refusal"));
    await expect(claudeChatJson("s", [{ role: "user", content: "x" }])).rejects.toThrow(/recusou/);
  });

  it("tenta de novo em sobrecarga e explica erros de chave", async () => {
    await setSetting("anthropic_api_key", "k");
    vi.useFakeTimers();

    httpFetch
      .mockResolvedValueOnce(res(529, { error: { message: "Overloaded" } }))
      .mockResolvedValueOnce(ok('{"ok":true}'));

    const p = claudeChatJson("s", [{ role: "user", content: "x" }]);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ json: { ok: true } });
    expect(httpFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();

    httpFetch.mockReset();
    httpFetch.mockResolvedValue(res(401, { error: { message: "invalid x-api-key" } }));
    await expect(claudeChatJson("s", [{ role: "user", content: "x" }])).rejects.toThrow(/Chave inválida/);
  });
});
