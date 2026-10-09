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
  validateOutreach,
  validatePlan,
} from "./ai.validation";

import { listChannelsRepository } from "../contacts/channels.repository";
import { replaceApproachesRepository } from "../contacts/approaches.repository";
import { APPROACH_CHANNELS } from "../contacts/approaches.engine";
import type { Approach } from "../contacts/approaches.engine";
import { matchServices } from "../services/offers.engine";
import { listServices } from "../services/services.service";
import type { ServiceKey } from "../services/services.service";

import type {
  AiAnalysisResult,
  AiBottleneck,
  AiOutreachResult,
} from "./ai.validation";

export interface StoredAnalysis extends AiAnalysisResult {
  id: number;
  company_id: number;
  model: string | null;
  /** JSON: [{ service_key, reason, pitch }] */
  recommended_services: string | null;
  /** JSON: [{ title, evidence[], service_key, impact, confidence }] */
  bottlenecks: string | null;
  created_at: string;
}

const SYSTEM_RULES = `Você é um analista comercial da agência Creava Digital. A Creava NÃO vende apenas sites: vende o catálogo de serviços informado (landing pages, sites e lojas, softwares e aplicativos, sistemas e automações, suporte contínuo).
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

/**
 * UMA chamada de IA por empresa: análise + serviços recomendados +
 * abordagens por canal. Tudo é validado contra o catálogo, os canais
 * reais e os sinais existentes antes de salvar.
 */
export async function planCompanyWithAi(
  companyId: number,
  chat: ChatJson = openaiChatJson,
): Promise<StoredAnalysis> {
  const { context, signals } = await buildContext(companyId);

  const [services, channels, company] = await Promise.all([
    listServices(true),
    listChannelsRepository(companyId),
    getCompanyRepository(companyId),
  ]);

  const channelKinds = [
    ...new Set(channels.map((c) => c.kind as string)),
  ].filter((k) => (APPROACH_CHANNELS as string[]).includes(k));

  const hints = matchServices({
    company: company!,
    signals,
    facts: null,
    activeKeys: services.map((s) => s.key as ServiceKey),
  });

  const seller = (await getSetting("seller_name")) ?? "";
  const agency = (await getSetting("company_name")) ?? "Creava Digital";

  const { json, model } = await chat([
    { role: "system", content: SYSTEM_RULES },
    {
      role: "user",
      content: `Analise a empresa e ajude a decidir COMO vender os serviços da ${agency}${seller ? ` (vendedor: ${seller})` : ""}.
Responda JSON com:
- summary, main_problem, opportunity, recommended_offer, outreach_angle (strings) e confidence (0 a 1);
- bottlenecks: lista de gargalos do negócio que a Creava resolve, cada um {"title", "evidence", "service_key", "impact", "confidence"}. "evidence" é a lista de TIPOS de sinais (da lista de sinais dos dados) que provam o gargalo: gargalo sem sinal existente NÃO deve ser listado. "impact" é o efeito provável no negócio, em 1 frase, sem números inventados;
- recommended_services: lista de {"service_key", "reason", "pitch"} usando SOMENTE chaves do catálogo e razões baseadas nos dados;
- approaches: até 3 abordagens {"channel", "service_key", "angle", "message", "evidence_used"}. channel deve estar em ${JSON.stringify(channelKinds)}; message curta (máx. 600 caracteres), tom humano, sem links; evidence_used lista APENAS tipos de sinal que existem nos dados (lista vazia se nenhum).
Só afirme problemas que correspondam a um sinal listado.
Catálogo: ${JSON.stringify(services.map((s) => ({ service_key: s.key, nome: s.name, descricao: s.description, dores: s.pain_points })))}
Sugestões determinísticas (podem ajudar): ${JSON.stringify(hints.map((h) => ({ service_key: h.key, motivos: h.reasons })))}
Dados: ${JSON.stringify(context)}`,
    },
  ]);

  const plan = validatePlan(json, {
    serviceKeys: services.map((s) => s.key),
    channels: channelKinds,
    signalTypes: signals.map((s) => s.type),
  });

  unwrap(
    await getSupabase().from("ai_analyses").insert({
      company_id: companyId,
      summary: plan.analysis.summary,
      main_problem: plan.analysis.main_problem,
      opportunity: plan.analysis.opportunity,
      recommended_offer: plan.analysis.recommended_offer,
      outreach_angle: plan.analysis.outreach_angle,
      confidence: plan.analysis.confidence,
      model,
      recommended_services: JSON.stringify(plan.services),
      bottlenecks: JSON.stringify(plan.bottlenecks),
    }),
  );

  await replaceApproachesRepository(
    companyId,
    "AI",
    plan.approaches.map(
      (a): Approach => ({
        channel: a.channel as Approach["channel"],
        service_key: a.service_key as ServiceKey | null,
        angle: a.angle,
        message: a.message,
        evidence_used: a.evidence_used as Approach["evidence_used"],
      }),
    ),
  );

  return (await getLatestAnalysis(companyId))!;
}

/** Gargalos validados (com evidência real) da última análise. */
export function parseBottlenecks(
  analysis: Pick<StoredAnalysis, "bottlenecks"> | null,
): AiBottleneck[] {
  if (!analysis?.bottlenecks) return [];

  try {
    const parsed = JSON.parse(analysis.bottlenecks);

    return Array.isArray(parsed) ? (parsed as AiBottleneck[]) : [];
  } catch {
    return [];
  }
}

/** Compatibilidade: a "análise" agora já inclui serviços e abordagens. */
export const analyzeCompany = planCompanyWithAi;

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
