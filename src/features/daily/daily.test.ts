import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMigratedTestDb } from "../../test/testDb";
import type { Db } from "../../test/dbTypes";

let db: Db;

vi.mock("../../lib/supabase", async () => {
  const { testClient } = await import("../../test/testDb");
  return { getSupabase: () => testClient() };
});
vi.mock("../../lib/http", () => ({ httpFetch: vi.fn() }));

const planCompanyWithAi = vi.fn();
vi.mock("../ai/ai.service", async (orig) => ({
  ...(await orig<typeof import("../ai/ai.service")>()),
  planCompanyWithAi: (...a: unknown[]) => planCompanyWithAi(...a),
}));

import { importCompany } from "../companies/company.service";
import { setLeadStatusRepository } from "../companies/company.repository";
import { saveScoreRepository } from "../enrichment/enrichment.repository";
import { ensureServicesSeed } from "../services/services.service";
import { suppressCompany } from "../compliance/suppression.service";
import { getJob } from "../jobs/job.service";
import { listPendingTasks } from "../tasks/task.service";
import { getSupabase } from "../../lib/supabase";
import { createProspect } from "../prospects/prospect.service";
import { getDashboardMetrics } from "../dashboard/dashboard.service";
import { getLearningSummary } from "../agent/learning.service";
import { listConversationSummaries, loadThread } from "../agent/conversation.service";
import { isCompanySuppressed } from "../compliance/suppression.service";
import { getDashboardMetrics as metrics } from "../dashboard/dashboard.service";
import {
  getLastDayRun,
  planDay,
  startDay,
} from "./daily.service";
import {
  loadCallDossier,
  recordCallOutcome,
  saveBottleneckFeedback,
} from "./call.service";

async function qualified(name: string, score: number, extra: Record<string, unknown> = {}) {
  const id = (await importCompany({ name, city: "Cuiabá", ...extra }, "MANUAL")).id;
  await setLeadStatusRepository(id, "QUALIFIED");
  await saveScoreRepository(id, {
    fit: 10, need: 10, capacity: 10, intent: 10, total: score, confidence: 0.8, reasons: [],
  } as never);
  return id;
}

async function waitJob(id: number) {
  for (let i = 0; i < 100; i++) {
    const job = await getJob(id);
    if (job && (job.status === "COMPLETED" || job.status === "FAILED")) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job não terminou");
}

beforeEach(async () => {
  db = await createMigratedTestDb();
  await ensureServicesSeed();
  planCompanyWithAi.mockReset();
});

describe("montar o dia", () => {
  it("escolhe as melhores qualificadas, sem suprimidas, e respeita o limite", async () => {
    const a = await qualified("Alta", 90);
    const b = await qualified("Média", 60);
    const c = await qualified("Suprimida", 99, { phone: "(65) 93333-0001" });
    await suppressCompany(c, "pediu para parar");
    await qualified("Baixa", 20);

    const day = await planDay(2);

    expect(day.map((d) => d.companyId)).toEqual([a, b]);
    expect(day[0]).toMatchObject({ score: 90, hasFreshDiagnosis: false });
  });

  it("gera diagnóstico só de quem não tem, inicia a abordagem e registra o dia", async () => {
    const a = await qualified("Com diagnóstico", 80);
    const b = await qualified("Sem diagnóstico", 70);

    await getSupabase().from("ai_analyses").insert({
      company_id: a, summary: "s", main_problem: "p", opportunity: "o",
      recommended_offer: "r", outreach_angle: "x", confidence: 0.5,
    });
    planCompanyWithAi.mockResolvedValue({});

    const job = await waitJob(await startDay([a, b], { useAi: true }));
    const result = JSON.parse(job.result!);

    expect(job.status).toBe("COMPLETED");
    expect(result).toMatchObject({ prospected: 2, diagnosed: 1, aiFailed: 0, failed: 0 });
    expect(planCompanyWithAi).toHaveBeenCalledTimes(1);
    expect(planCompanyWithAi.mock.calls[0][0]).toBe(b);
    expect((await listPendingTasks()).map((t) => t.type)).toEqual(["FIRST_CONTACT", "FIRST_CONTACT"]);
    expect(await getLastDayRun()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falha da IA não impede a abordagem e é contada", async () => {
    const a = await qualified("Sem IA", 80);
    planCompanyWithAi.mockRejectedValue(new Error("Sem crédito"));

    const job = await waitJob(await startDay([a], { useAi: true }));

    expect(JSON.parse(job.result!)).toMatchObject({ prospected: 1, aiFailed: 1, errors: ["Sem crédito"] });
  });

  it("sem IA não chama a OpenAI", async () => {
    const a = await qualified("Só ligação", 80);
    await waitJob(await startDay([a], { useAi: false }));
    expect(planCompanyWithAi).not.toHaveBeenCalled();
  });
});

describe("resultado da ligação", () => {
  let n = 0;

  async function inOutreach(name = "Clínica Sorriso") {
    const companyId = await qualified(name, 80, { phone: `(65) 99999-${String(1000 + ++n)}` });
    const prospectId = await createProspect(companyId);
    return { companyId, prospectId };
  }

  const stage = async () => (await listConversationSummaries())[0].stage;
  const task = async () => (await listPendingTasks())[0];

  it("não atendeu: continua pronta e a ligação volta amanhã, sem contar como contato", async () => {
    const { prospectId } = await inOutreach();
    await recordCallOutcome({ prospectId, outcome: "NO_ANSWER" });

    expect(await stage()).toBe("READY");
    expect(await task()).toBeUndefined(); // adiada para amanhã
    expect((await metrics()).contactsSent).toBe(0);
  });

  it("pediu para ligar depois: vira Contatado e conta como contato", async () => {
    const { prospectId } = await inOutreach();
    await recordCallOutcome({ prospectId, outcome: "CALLBACK", note: "ligar quinta" });

    expect(await stage()).toBe("CONTACTED");
    expect((await metrics()).contactsSent).toBe(1);
  });

  it("interesse: vira Respondeu, entra no histórico e abre a tarefa de reunião", async () => {
    const { companyId, prospectId } = await inOutreach();
    await recordCallOutcome({ prospectId, outcome: "INTERESTED", note: "quer ver uma proposta" });

    expect(await stage()).toBe("REPLIED");
    expect((await loadThread(companyId)).messages[0]).toMatchObject({
      direction: "IN",
      body: "[Ligação] quer ver uma proposta",
    });
    expect((await task()).type).toBe("MEETING");

    const m = await metrics();
    expect(m).toMatchObject({ contactsSent: 1, replies: 1 });
  });

  it("sem interesse fecha como perdido; pedido para não contatar suprime a empresa", async () => {
    const a = await inOutreach("Sem Interesse");
    await recordCallOutcome({ prospectId: a.prospectId, outcome: "NOT_INTERESTED" });
    expect((await metrics()).lost).toBe(1);

    const b = await inOutreach("Não Ligar");
    await recordCallOutcome({ prospectId: b.prospectId, outcome: "DO_NOT_CONTACT" });
    expect(await isCompanySuppressed(b.companyId)).toBe(true);
    await expect(recordCallOutcome({ prospectId: b.prospectId, outcome: "NO_ANSWER" })).rejects.toThrow(/não ser contatada/);
  });
});

describe("retorno sobre os gargalos", () => {
  it("guarda o veredito, mostra no dossiê e alimenta a precisão por sinal", async () => {
    const companyId = await qualified("Clínica", 70);
    await getSupabase().from("ai_analyses").insert({
      company_id: companyId, summary: "s", main_problem: "p", opportunity: "o",
      recommended_offer: "r", outreach_angle: "Ângulo sugerido", confidence: 0.5,
      bottlenecks: JSON.stringify([
        { title: "Sem botão de ação", evidence: ["NO_CLEAR_CTA"], service_key: "LANDING_PAGE", impact: "i", confidence: 0.8, question: "Como pedem orçamento hoje?" },
        { title: "Site sem cadeado", evidence: ["NO_HTTPS"], service_key: "SITE_LOJA", impact: "i", confidence: 0.7 },
      ]),
    });

    let dossier = await loadCallDossier(companyId);
    expect(dossier).toMatchObject({ hasDiagnosis: true, opening: "Ângulo sugerido" });
    expect(dossier.bottlenecks.map((b) => b.verdict)).toEqual([null, null]);

    await saveBottleneckFeedback(companyId, dossier.bottlenecks[0], "CONFIRMED");
    await saveBottleneckFeedback(companyId, dossier.bottlenecks[1], "WRONG");
    await saveBottleneckFeedback(companyId, dossier.bottlenecks[1], "UNKNOWN"); // reavaliar substitui

    dossier = await loadCallDossier(companyId);
    expect(dossier.bottlenecks.map((b) => b.verdict)).toEqual(["CONFIRMED", "UNKNOWN"]);

    const { diagnosis } = await getLearningSummary();
    expect(diagnosis).toMatchObject({ evaluated: 2, confirmed: 1, wrong: 0, unknown: 1 });
    expect(diagnosis.bySignal).toEqual([{ type: "NO_CLEAR_CTA", confirmed: 1, wrong: 0 }]);
  });

  it("empresa sem diagnóstico devolve dossiê vazio, sem erro", async () => {
    const companyId = await qualified("Sem IA", 50);
    expect(await loadCallDossier(companyId)).toMatchObject({ hasDiagnosis: false, bottlenecks: [], opening: null });
  });
});
