import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../lib/database";

let db: Db;
vi.mock("../../lib/database", () => ({ getDatabase: async () => db }));

const httpFetch = vi.fn();
vi.mock("../../lib/http", () => ({ httpFetch: (...a: unknown[]) => httpFetch(...a) }));

import { setSetting } from "../settings/settings.service";
import { testOpenAiConnection } from "./openai.client";

const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

beforeEach(async () => {
  db = await createMigratedTestDb();
  httpFetch.mockReset();
});

describe("openai connection", () => {
  it("requires a key", async () => {
    await expect(testOpenAiConnection()).rejects.toThrow(/chave/i);
  });

  it("succeeds, sends the key only as bearer and records usage", async () => {
    await setSetting("openai_api_key", "sk-test");
    httpFetch.mockResolvedValue(res(200, {
      choices: [{ message: { content: '{"ok": true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    expect(await testOpenAiConnection()).toMatch(/Conexão OK/);
    expect(httpFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-test");
    const [u] = await db.select<{ tokens: number }[]>("SELECT tokens FROM api_usage WHERE provider='OPENAI'");
    expect(u.tokens).toBe(15);
  });

  it("explains quota and invalid key errors", async () => {
    await setSetting("openai_api_key", "sk-test");
    httpFetch.mockResolvedValue(res(429, { error: { code: "insufficient_quota", message: "quota" } }));
    await expect(testOpenAiConnection()).rejects.toThrow(/Sem crédito/);
    httpFetch.mockResolvedValue(res(401, { error: { message: "bad key" } }));
    await expect(testOpenAiConnection()).rejects.toThrow(/Chave inválida/);
  });
});
