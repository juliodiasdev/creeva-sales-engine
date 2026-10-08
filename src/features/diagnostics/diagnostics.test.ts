import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;
vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});

const httpFetch = vi.fn();
vi.mock("../../lib/http", () => ({ httpFetch: (...a: unknown[]) => httpFetch(...a) }));

import { setSetting } from "../settings/settings.service";
import { runDiagnostics } from "./diagnostics.service";

const ok = (body: unknown, extra = {}) => ({ ok: true, status: 200, url: "https://example.com/", json: async () => body, text: async () => "<html><head><title>x</title></head><body>oi</body></html>", ...extra });

const analysis = { summary: "s", main_problem: "p", opportunity: "o", recommended_offer: "r", outreach_angle: "a", confidence: 0.6 };

beforeEach(async () => {
  db = await createMigratedTestDb();
  httpFetch.mockReset();
});

describe("diagnostics", () => {
  it("passes end to end with keys and cleans up the test company", async () => {
    await setSetting("openai_api_key", "sk-x");
    await setSetting("google_api_key", "g-x");
    let call = 0;
    httpFetch.mockImplementation(async (url: string) => {
      if (url.includes("places.googleapis.com")) return ok({ places: [{ id: "1" }] });
      if (url.includes("openai.com")) {
        call++;
        const content = call === 1 ? '{"ok": true}' : call === 2 ? JSON.stringify(analysis) : JSON.stringify({ message: "Oi!", evidence_used: [] });
        return ok({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return ok({}); // site de teste
    });

    const steps = await runDiagnostics();
    expect(steps.filter((s) => s.status === "FALHOU")).toEqual([]);
    expect(steps.at(-1)).toMatchObject({ name: "Limpeza do teste", status: "OK" });
    const [{ n }] = await db.select<{ n: number }[]>("SELECT COUNT(*) n FROM companies");
    expect(n).toBe(0);
  });

  it("reports missing OpenAI key and skips dependent steps", async () => {
    httpFetch.mockResolvedValue(ok({}));
    const steps = await runDiagnostics();
    const by = (name: string) => steps.find((s) => s.name === name)!;
    expect(by("Chave OpenAI configurada").status).toBe("FALHOU");
    expect(by("OpenAI (conexão)").status).toBe("PULADO");
    expect(by("Análise com IA").status).toBe("PULADO");
    expect(by("Banco de dados (nuvem)").status).toBe("OK");
  });
});
