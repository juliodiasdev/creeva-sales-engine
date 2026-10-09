import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

import { importCompany } from "../companies/company.service";
import { enrichCompany } from "../enrichment/enrichment.service";
import { extractWebsiteFacts } from "../enrichment/website.facts";
import { planCompanyWithAi, parseBottlenecks, getLatestAnalysis } from "../ai/ai.service";
import { ensureServicesSeed } from "../services/services.service";
import { createProspect } from "../prospects/prospect.service";
import { markTaskAsSent } from "../outreach/outreach.service";
import { listPendingTasks } from "../tasks/task.service";
import { isCompanySuppressed, looksLikeOptOut } from "../compliance/suppression.service";
import { validateDraft } from "./agent.validation";
import {
  confirmOptOut,
  listConversationSummaries,
  loadThread,
  recordIncomingMessage,
} from "./conversation.service";
import { approveDraft, draftReply } from "./agent.service";
import { getLearningSummary } from "./learning.service";

const plan = (bottlenecks: unknown) => ({
  summary: "s", main_problem: "p", opportunity: "o",
  recommended_offer: "r", outreach_angle: "a", confidence: 0.7,
  recommended_services: [{ service_key: "SITE_LOJA", reason: "sem https", pitch: "x" }],
  bottlenecks,
  approaches: [],
});

describe("validateDraft", () => {
  const ctx = { signalTypes: ["NO_HTTPS"] };
  const ok = { message: "Oi, tudo bem?", intent: "CONTINUE", handoff_reason: null, evidence_used: [] };

  it("aceita rascunho válido", () => {
    expect(validateDraft(ok, ctx).intent).toBe("CONTINUE");
  });

  it("rejeita preço, link, evidência inexistente e intenção inválida", () => {
    expect(() => validateDraft({ ...ok, message: "Custa R$ 2000" }, ctx)).toThrow(/valores/);
    expect(() => validateDraft({ ...ok, message: "Veja https://x.com" }, ctx)).toThrow(/link/);
    expect(() => validateDraft({ ...ok, evidence_used: ["NOPE"] }, ctx)).toThrow(/inexistente/);
    expect(() => validateDraft({ ...ok, intent: "VENDER" }, ctx)).toThrow(/Intenção/);
    expect(() => validateDraft({ ...ok, intent: "HANDOFF" }, ctx)).toThrow(/motivo/);
    expect(() => validateDraft({ ...ok, message: "a".repeat(701) }, ctx)).toThrow(/caracteres/);
  });
});

describe("looksLikeOptOut", () => {
  it("detecta pedidos para parar sem marcar conversa normal", () => {
    expect(looksLikeOptOut("Por favor, pare de me mandar mensagem")).toBe(true);
    expect(looksLikeOptOut("Não tenho interesse, obrigado")).toBe(true);
    expect(looksLikeOptOut("Tenho interesse, pode me ligar amanhã?")).toBe(false);
  });
});

describe("agente de conversa", () => {
  let companyId: number;

  beforeEach(async () => {
    db = await createMigratedTestDb();
    await ensureServicesSeed();
    companyId = (
      await importCompany(
        { name: "Clínica Sorriso", city: "Cuiabá", website: "http://c.com", phone: "(65) 99999-1111" },
        "MANUAL",
      )
    ).id;
    await enrichCompany(companyId, async (u) =>
      extractWebsiteFacts("<html><body>oi</body></html>", { url: u, finalUrl: u, httpStatus: 200 }),
    );
  });

  it("guarda só gargalos com evidência real", async () => {
    const chat = vi.fn().mockResolvedValue({
      json: plan([
        { title: "Site sem cadeado", evidence: ["NO_HTTPS"], service_key: "SITE_LOJA", impact: "Perde confiança", confidence: 0.8 },
        { title: "Inventado", evidence: ["NAO_EXISTE"], service_key: "SITE_LOJA", impact: "x", confidence: 0.9 },
        { title: "Sem evidência", evidence: [], service_key: "SITE_LOJA", impact: "x", confidence: 0.9 },
        { title: "Serviço falso", evidence: ["NO_HTTPS"], service_key: "OUTRO", impact: "x", confidence: 0.9 },
      ]),
      model: "m",
    });

    await planCompanyWithAi(companyId, chat);

    const b = parseBottlenecks(await getLatestAnalysis(companyId));
    expect(b.map((x) => x.title)).toEqual(["Site sem cadeado"]);
  });

  async function withBriefing() {
    await planCompanyWithAi(companyId, vi.fn().mockResolvedValue({
      json: plan([{ title: "Site sem cadeado", evidence: ["NO_HTTPS"], service_key: "SITE_LOJA", impact: "i", confidence: 0.8 }]),
      model: "m",
    }));
  }

  const claude = (json: unknown) => vi.fn().mockResolvedValue({ json, model: "claude-x" });
  const good = { message: "Obrigado pelo retorno! Posso te mostrar como resolver isso?", intent: "BOOK_MEETING", handoff_reason: null, evidence_used: ["NO_HTTPS"] };

  it("só responde a quem escreveu e usa histórico + diagnóstico", async () => {
    await withBriefing();

    await expect(draftReply(companyId, {}, claude(good))).rejects.toThrow(/só responde a quem já escreveu/);

    await recordIncomingMessage(companyId, "Oi, vi sua mensagem. Como funciona?");

    const chat = claude(good);
    const out = await draftReply(companyId, {}, chat);

    expect(out.intent).toBe("BOOK_MEETING");
    const [system, turns] = chat.mock.calls[0];
    expect(system).toContain("Nunca informe preço");
    expect(turns[0].content).toContain("Site sem cadeado");
    expect(turns[0].content).toContain("Como funciona?");

    const thread = await loadThread(companyId);
    expect(thread.messages.at(-1)).toMatchObject({ status: "DRAFT", author: "AI", direction: "OUT" });
  });

  it("tenta de novo quando o rascunho viola as regras e falha se continuar inválido", async () => {
    await withBriefing();
    await recordIncomingMessage(companyId, "Quanto custa?");

    const chat = vi.fn()
      .mockResolvedValueOnce({ json: { ...good, message: "Custa R$ 3000" }, model: "m" })
      .mockResolvedValueOnce({ json: good, model: "m" });
    await expect(draftReply(companyId, {}, chat)).resolves.toBeTruthy();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][1].at(-1).content).toContain("Rejeitado");

    const bad = claude({ ...good, message: "Custa R$ 3000" });
    await expect(draftReply(companyId, {}, bad)).rejects.toThrow(/válido/);
  });

  it("aprovar registra envio, marca edição e alimenta o aprendizado", async () => {
    await withBriefing();
    const prospectId = await createProspect(companyId);
    const [task] = await listPendingTasks();
    await markTaskAsSent(task.id, "Olá! Conheci a Clínica Sorriso.");
    await recordIncomingMessage(companyId, "Pode falar, qual a ideia?");

    const out = await draftReply(companyId, {}, claude(good));
    await approveDraft(out.messageId, "Obrigado! Posso te mostrar rapidinho?");

    const thread = await loadThread(companyId);
    expect(thread.messages.map((m) => `${m.direction}:${m.author}:${m.status}`)).toEqual([
      "OUT:HUMAN:SENT",
      "IN:LEAD:RECEIVED",
      "OUT:AI:SENT",
    ]);
    expect(thread.messages[2].edited).toBe(1);

    const learning = await getLearningSummary();
    expect(learning).toMatchObject({ aiSent: 1, aiEdited: 1, conversationsWithReply: 1 });
    const row = learning.byService.find((r) => r.serviceKey === "SITE_LOJA")!;
    expect(row).toMatchObject({ prospects: 1, contacted: 1, replied: 1 });

    const [summary] = await listConversationSummaries();
    expect(summary).toMatchObject({ prospectId, stage: "REPLIED", awaitingReply: false });
  });

  it("pedido para parar bloqueia rascunho, suprime a empresa e impede novo prospect", async () => {
    await withBriefing();
    await createProspect(companyId);
    const { optOutSuspected } = await recordIncomingMessage(companyId, "Não tenho interesse, pare de mandar mensagem");
    expect(optOutSuspected).toBe(true);

    await expect(draftReply(companyId, {}, claude(good))).rejects.toThrow(/pedido para parar/);
    await expect(draftReply(companyId, { ignoreOptOutWarning: true }, claude(good))).resolves.toBeTruthy();

    await confirmOptOut(companyId);

    expect(await isCompanySuppressed(companyId)).toBe(true);
    await expect(draftReply(companyId, { ignoreOptOutWarning: true }, claude(good))).rejects.toThrow(/não ser contatada/);
    await expect(createProspect(companyId)).rejects.toThrow(/já está|não ser contatada/);

    // O mesmo telefone em outra empresa também fica suprimido.
    const other = (await importCompany({ name: "Outra Clínica", city: "Cuiabá", phone: "(65) 99999-1111" }, "MANUAL"));
    if (other.created) {
      await expect(createProspect(other.id)).rejects.toThrow(/não ser contatada/);
    }
  });
});
