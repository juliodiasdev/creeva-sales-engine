import { getSupabase, unwrap } from "../../lib/store";

import { importCompany } from "../companies/company.service";
import { testGooglePlacesConnection } from "../discovery/googlePlaces.client";
import { enrichCompany } from "../enrichment/enrichment.service";
import { analyzeCompany, generateAiOutreach } from "../ai/ai.service";
import { testOpenAiConnection } from "../ai/openai.client";
import { getSetting } from "../settings/settings.service";

export interface DiagnosticStep {
  name: string;
  status: "OK" | "FALHOU" | "PULADO";
  detail: string;
}

type Runner = () => Promise<string>;

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "erro desconhecido";
}

/** Remove o que o diagnóstico criou, sem depender de cascade de FK. */
async function cleanup(companyId: number): Promise<void> {
  const supabase = getSupabase();

  for (const table of [
    "ai_analyses",
    "company_scores",
    "signals",
    "website_snapshots",
    "company_sources",
  ]) {
    unwrap(await supabase.from(table).delete().eq("company_id", companyId));
  }

  unwrap(await supabase.from("companies").delete().eq("id", companyId));
}

/**
 * Roda, em ordem: banco, Google Places, OpenAI e o fluxo completo
 * (empresa de teste -> enriquecimento -> análise IA -> mensagem IA).
 * A empresa de teste é sempre removida ao final.
 */
export async function runDiagnostics(
  onStep?: (steps: DiagnosticStep[]) => void,
): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];
  let companyId: number | null = null;
  let aborted = false;

  const add = (step: DiagnosticStep) => {
    steps.push(step);
    onStep?.([...steps]);
  };

  async function run(
    name: string,
    fn: Runner,
    options: { needs?: string[]; critical?: boolean } = {},
  ) {
    const blocked = (options.needs ?? []).some(
      (n) => steps.find((s) => s.name === n)?.status !== "OK",
    );

    if (aborted || blocked) {
      add({ name, status: "PULADO", detail: "depende de uma etapa anterior" });
      return;
    }

    try {
      add({ name, status: "OK", detail: await fn() });
    } catch (err) {
      add({ name, status: "FALHOU", detail: messageOf(err) });
      if (options.critical) aborted = true;
    }
  }

  await run(
    "Banco de dados (nuvem)",
    async () => {
      const supabase = getSupabase();
      unwrap(
        await supabase
          .from("settings")
          .upsert({ key: "diag_probe", value: "1" }, { onConflict: "key" }),
      );
      const row = unwrap(
        await supabase
          .from("settings")
          .select("value")
          .eq("key", "diag_probe")
          .maybeSingle(),
      ) as { value: string } | null;
      unwrap(await supabase.from("settings").delete().eq("key", "diag_probe"));
      if (row?.value !== "1") throw new Error("leitura/gravação inconsistente");
      return "leitura e gravação funcionando";
    },
    { critical: true },
  );

  await run("Chave Google configurada", async () => {
    if (!(await getSetting("google_api_key"))) {
      throw new Error("chave do Google não configurada (opcional para o teste da IA)");
    }
    return "configurada";
  });

  await run(
    "Google Places",
    testGooglePlacesConnection,
    { needs: ["Chave Google configurada"] },
  );

  await run("Chave OpenAI configurada", async () => {
    if (!(await getSetting("openai_api_key"))) {
      throw new Error("chave da OpenAI não configurada");
    }
    return "configurada";
  });

  await run(
    "OpenAI (conexão)",
    testOpenAiConnection,
    { needs: ["Chave OpenAI configurada"] },
  );

  await run(
    "Empresa de teste",
    async () => {
      const result = await importCompany(
        {
          name: "__DIAGNOSTICO__ Clínica Teste",
          segment: "Odontologia",
          city: "Cuiabá",
          state: "MT",
          website: "https://example.com",
          address: `Rua de Teste ${Date.now()}`,
        },
        "MANUAL",
      );
      companyId = result.id;
      return `criada (id ${result.id})`;
    },
    { needs: ["Banco de dados (nuvem)"] },
  );

  await run(
    "Enriquecimento (site, sinais e score)",
    async () => {
      const outcome = await enrichCompany(companyId!);
      return `score ${outcome.total}/100, status ${outcome.status}`;
    },
    { needs: ["Empresa de teste"] },
  );

  await run(
    "Análise com IA",
    async () => {
      const analysis = await analyzeCompany(companyId!);
      return `ok (confiança ${Math.round(analysis.confidence * 100)}%)`;
    },
    { needs: ["Enriquecimento (site, sinais e score)", "OpenAI (conexão)"] },
  );

  await run(
    "Mensagem de abordagem com IA",
    async () => {
      const result = await generateAiOutreach(companyId!, "FIRST_CONTACT");
      return `ok (${result.message.length} caracteres, evidências: ${result.evidence_used.join(", ") || "nenhuma"})`;
    },
    { needs: ["Análise com IA"] },
  );

  if (companyId !== null) {
    try {
      await cleanup(companyId);
      add({ name: "Limpeza do teste", status: "OK", detail: "empresa de teste removida" });
    } catch (err) {
      add({ name: "Limpeza do teste", status: "FALHOU", detail: messageOf(err) });
    }
  }

  return steps;
}
