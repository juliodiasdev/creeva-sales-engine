import { getSupabase, unwrap } from "../../lib/store";

import { getCompanyRepository } from "../companies/company.repository";

import {
  getLatestScoreRepository,
  getLatestSnapshotRepository,
  listSignalsRepository,
} from "../enrichment/enrichment.repository";

import { getSetting } from "../settings/settings.service";

import { openaiChatJson } from "./openai.client";
import type { ChatJson } from "./openai.client";

import {
  validateAnalysis,
  validateOutreach,
} from "./ai.validation";

import type {
  AiAnalysisResult,
  AiOutreachResult,
} from "./ai.validation";

export interface StoredAnalysis extends AiAnalysisResult {
  id: number;
  company_id: number;
  model: string | null;
  created_at: string;
}

const SYSTEM_RULES = `Você é um analista comercial da agência Creava Digital (sites, presença digital e geração de clientes).
Regras obrigatórias:
- Use SOMENTE os fatos, sinais e evidências fornecidos no JSON. Nunca invente dados.
- Se a evidência for insuficiente, diga isso e use confiança baixa.
- Responda apenas com JSON válido, em português do Brasil.`;

/** Contexto enviado à IA: fatos e sinais, nunca HTML bruto. */
async function buildContext(companyId: number) {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const [signals, score, snapshot] = await Promise.all([
    listSignalsRepository(companyId),
    getLatestScoreRepository(companyId),
    getLatestSnapshotRepository(companyId),
  ]);

  return {
    signals,
    context: {
      empresa: {
        nome: company.name,
        segmento: company.segment,
        cidade: company.city,
        uf: company.state,
        website: company.website,
        avaliacao_google: company.rating,
        qtd_avaliacoes: company.reviews_count,
        porte: company.company_size,
        situacao_cnpj: company.registration_status,
      },
      website: snapshot && {
        status_http: snapshot.httpStatus,
        https: snapshot.https,
        titulo: snapshot.title,
        descricao: snapshot.description,
        titulos_paginas: snapshot.headings,
        ctas: snapshot.ctas,
        formularios: snapshot.formsCount,
        tem_whatsapp: snapshot.whatsappLinks.length > 0,
        tecnologias: snapshot.technologies,
        redes_sociais: Object.keys(snapshot.socialLinks),
      },
      sinais: signals.map((s) => ({
        tipo: s.type,
        evidencia: s.evidence,
        confianca: s.confidence,
      })),
      score: score && {
        total: score.total,
        fit: score.fit,
        need: score.need,
        capacity: score.capacity,
        intent: score.intent,
      },
    },
  };
}

export async function analyzeCompany(
  companyId: number,
  chat: ChatJson = openaiChatJson,
): Promise<StoredAnalysis> {
  const { context } = await buildContext(companyId);

  const { json, model } = await chat([
    { role: "system", content: SYSTEM_RULES },
    {
      role: "user",
      content: `Analise a empresa e responda com as chaves: summary, main_problem, opportunity, recommended_offer, outreach_angle (strings) e confidence (número de 0 a 1).\n${JSON.stringify(context)}`,
    },
  ]);

  const analysis = validateAnalysis(json);

  unwrap(
    await getSupabase().from("ai_analyses").insert({
      company_id: companyId,
      summary: analysis.summary,
      main_problem: analysis.main_problem,
      opportunity: analysis.opportunity,
      recommended_offer: analysis.recommended_offer,
      outreach_angle: analysis.outreach_angle,
      confidence: analysis.confidence,
      model,
    }),
  );

  return (await getLatestAnalysis(companyId))!;
}

export async function getLatestAnalysis(
  companyId: number,
): Promise<StoredAnalysis | null> {
  const rows = unwrap(
    await getSupabase()
      .from("ai_analyses")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: false })
      .limit(1),
  ) as StoredAnalysis[];

  return rows[0] ?? null;
}

/**
 * Mensagem de abordagem com evidência real. O usuário revisa,
 * copia e envia manualmente: nada é enviado automaticamente.
 */
export async function generateAiOutreach(
  companyId: number,
  kind: "FIRST_CONTACT" | "FOLLOW_UP",
  chat: ChatJson = openaiChatJson,
): Promise<AiOutreachResult> {
  const { context, signals } = await buildContext(companyId);

  const analysis =
    (await getLatestAnalysis(companyId)) ??
    (await analyzeCompany(companyId, chat));

  const seller = (await getSetting("seller_name")) ?? "";
  const agency = (await getSetting("company_name")) ?? "Creava Digital";

  const { json } = await chat([
    { role: "system", content: SYSTEM_RULES },
    {
      role: "user",
      content: `Escreva uma mensagem curta (máx. 600 caracteres) de ${
        kind === "FIRST_CONTACT"
          ? "primeiro contato"
          : "follow-up"
      } para WhatsApp, tom humano e respeitoso, sem links e sem pressão. Remetente: ${seller || "equipe"} da ${agency}.
Só mencione um problema do site/negócio se ele corresponder a um sinal listado; cite em "evidence_used" os tipos dos sinais usados (lista vazia se nenhum). Não afirme análises que não constam nos dados.
Responda JSON: {"message": string, "evidence_used": string[]}.
Ângulo sugerido: ${analysis.outreach_angle}
${JSON.stringify(context)}`,
    },
  ]);

  return validateOutreach(
    json,
    signals.map((s) => s.type),
  );
}
