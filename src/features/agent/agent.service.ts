import { createActivityRepository } from "../activities/activity.repository";
import { claudeChatJson } from "../ai/anthropic.client";
import type { ClaudeChatJson } from "../ai/anthropic.client";
import { getLatestAnalysis, parseBottlenecks } from "../ai/ai.service";
import { getCompanyRepository } from "../companies/company.repository";
import { isCompanySuppressed, looksLikeOptOut } from "../compliance/suppression.service";
import { listSignalsRepository } from "../enrichment/enrichment.repository";
import { listServices } from "../services/services.service";
import { getSetting } from "../settings/settings.service";

import {
  findProspectByCompanyRepository,
  getConversationRepository,
  getMessageRepository,
  getOrCreateConversationRepository,
  insertMessageRepository,
  listAllMessagesRepository,
  listMessagesRepository,
  updateConversationRepository,
  updateMessageRepository,
} from "./agent.repository";

import { validateDraft } from "./agent.validation";
import type { ConversationMessage } from "./agent.types";

const HISTORY_LIMIT = 20;

const SYSTEM = (seller: string, agency: string) => `Você escreve rascunhos de mensagens de WhatsApp em nome ${seller ? `de ${seller}, ` : "do vendedor "}da ${agency}, uma agência que atua com landing pages, sites e lojas virtuais, softwares e aplicativos, sistemas e automações e suporte contínuo. Você conversa com donos e gestores de empresas locais. O vendedor humano revisa e envia cada mensagem.
Regras obrigatórias:
- Use SOMENTE os dados do briefing e do histórico. Nunca invente fatos, números, resultados, clientes, preços, prazos ou promessas.
- Só aponte um problema da empresa se ele estiver nos "gargalos" do briefing (todos têm evidência real).
- Nunca informe preço. Se perguntarem valor, diga que depende do escopo e proponha uma conversa rápida (intent BOOK_MEETING).
- Mensagem curta (até 500 caracteres), tom humano e respeitoso, sem pressão, uma pergunta por vez, sem links.
- Se a pessoa pedir para parar, demonstrar irritação, fizer pergunta jurídica, técnica ou de preço que os dados não respondem, ou pedir para falar com um humano: intent HANDOFF, com "handoff_reason", e uma mensagem breve e educada.
- Se perguntarem se é uma pessoa ou um robô, diga com honestidade que é um assistente de IA que ajuda o vendedor.
- Responda SOMENTE com JSON: {"message": string, "intent": "CONTINUE" | "BOOK_MEETING" | "HANDOFF" | "CLOSE", "handoff_reason": string | null, "evidence_used": string[]}. "evidence_used" lista apenas tipos de sinais que existem no briefing (lista vazia se nenhum).`;

/**
 * Exemplos REAIS do próprio histórico: a 1ª mensagem que enviamos a
 * empresas que depois responderam. Auditável e sem treinar modelo.
 */
export async function getWinningExamples(
  excludeCompanyId: number,
  limit = 3,
): Promise<string[]> {
  const all = await listAllMessagesRepository();
  const repliedCompanies = new Set(
    all.filter((m) => m.direction === "IN").map((m) => Number(m.company_id)),
  );

  const examples: string[] = [];
  const seen = new Set<number>();

  for (const m of all) {
    const cid = Number(m.company_id);

    if (
      cid === excludeCompanyId ||
      seen.has(cid) ||
      !repliedCompanies.has(cid) ||
      m.direction !== "OUT" ||
      m.status !== "SENT"
    ) {
      continue;
    }

    seen.add(cid);
    examples.push(m.body.slice(0, 400));
  }

  return examples.slice(-limit);
}

function renderHistory(messages: ConversationMessage[]): string {
  return messages
    .filter((m) => m.status !== "DRAFT")
    .slice(-HISTORY_LIMIT)
    .map((m) => `[${m.direction === "IN" ? "Contato" : "Nós"}] ${m.body}`)
    .join("\n");
}

export interface DraftOutput {
  messageId: number;
  message: string;
  intent: string;
}

/**
 * Claude escreve o RASCUNHO da próxima resposta, usando o diagnóstico
 * (gargalos com evidência) e o histórico. Nada é enviado: o usuário
 * revisa, edita e envia pelo WhatsApp. Só responde a quem já escreveu.
 */
export async function draftReply(
  companyId: number,
  options: { ignoreOptOutWarning?: boolean } = {},
  chat: ClaudeChatJson = claudeChatJson,
): Promise<DraftOutput> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const conversation = await getOrCreateConversationRepository(companyId);

  if (conversation.opted_out === 1 || (await isCompanySuppressed(companyId))) {
    throw new Error(
      "Esta empresa pediu para não ser contatada: nenhuma mensagem pode ser preparada.",
    );
  }

  const messages = await listMessagesRepository(companyId);
  const sent = messages.filter((m) => m.status !== "DRAFT");

  if (!sent.some((m) => m.direction === "IN")) {
    throw new Error(
      "O agente só responde a quem já escreveu. Registre a resposta do contato primeiro.",
    );
  }

  if (sent[sent.length - 1].direction === "OUT") {
    throw new Error(
      "A última mensagem foi nossa: aguarde a resposta do contato.",
    );
  }

  const lastIn = [...sent].reverse().find((m) => m.direction === "IN");

  if (!options.ignoreOptOutWarning && lastIn && looksLikeOptOut(lastIn.body)) {
    throw new Error(
      "A última mensagem parece um pedido para parar. Confirme em “Não contatar mais” ou escolha continuar mesmo assim.",
    );
  }

  const analysis = await getLatestAnalysis(companyId);

  if (!analysis) {
    throw new Error(
      'Gere o diagnóstico da empresa primeiro (botão "Gerar plano com IA" na empresa).',
    );
  }

  const [signals, services, seller, agency] = await Promise.all([
    listSignalsRepository(companyId),
    listServices(true),
    getSetting("seller_name"),
    getSetting("company_name"),
  ]);

  const serviceName = new Map(services.map((s) => [s.key, s.name]));
  const examples = await getWinningExamples(companyId);

  const briefing = {
    empresa: {
      nome: company.name,
      segmento: company.segment,
      cidade: company.city,
      avaliacao_google: company.rating,
      qtd_avaliacoes: company.reviews_count,
    },
    resumo: analysis.summary,
    oportunidade: analysis.opportunity,
    angulo_sugerido: analysis.outreach_angle,
    gargalos: parseBottlenecks(analysis).map((b) => ({
      gargalo: b.title,
      evidencias: b.evidence,
      servico: serviceName.get(b.service_key) ?? b.service_key,
      impacto: b.impact,
    })),
    tipos_de_sinais_validos: signals.map((s) => s.type),
    exemplos_de_primeira_mensagem_que_geraram_resposta: examples,
  };

  const userContent = `BRIEFING (dados reais):\n${JSON.stringify(briefing)}\n\nHISTÓRICO DA CONVERSA:\n${renderHistory(messages)}\n\nEscreva a próxima mensagem em resposta ao contato (última mensagem dele: "${lastIn?.body ?? ""}").`;

  const signalTypes = signals.map((s) => s.type);
  const turns: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: userContent },
  ];

  let lastError = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const { json, model } = await chat(
      SYSTEM(seller ?? "", agency ?? "Creava Digital"),
      turns,
    );

    try {
      const draft = validateDraft(json, { signalTypes });

      if (draft.intent === "HANDOFF") {
        await updateConversationRepository(conversation.id, {
          handoff_reason: draft.handoffReason,
        });
      }

      const messageId = await insertMessageRepository({
        conversationId: conversation.id,
        companyId,
        direction: "OUT",
        author: "AI",
        body: draft.message,
        status: "DRAFT",
        intent: draft.intent,
        model,
        evidenceUsed: draft.evidenceUsed,
      });

      // Rascunhos antigos pendentes são substituídos pelo novo.
      for (const old of messages.filter((m) => m.status === "DRAFT")) {
        await updateMessageRepository(old.id, { status: "DISCARDED" });
      }

      return { messageId, message: draft.message, intent: draft.intent };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      turns.push(
        { role: "assistant", content: JSON.stringify(json) },
        {
          role: "user",
          content: `Rejeitado: ${lastError} Corrija e responda de novo apenas com o JSON.`,
        },
      );
    }
  }

  throw new Error(`O Claude não conseguiu gerar um rascunho válido: ${lastError}`);
}

/**
 * O usuário aprova (e pode editar) o rascunho e o envia no WhatsApp.
 * Aqui registramos o envio no histórico e no funil.
 */
export async function approveDraft(
  messageId: number,
  finalText: string,
): Promise<void> {
  const draft = await getMessageRepository(messageId);

  if (!draft || draft.status !== "DRAFT" || draft.direction !== "OUT") {
    throw new Error("Rascunho não encontrado ou já tratado.");
  }

  const text = finalText.trim();

  if (!text) throw new Error("A mensagem não pode ficar vazia.");

  if (await isCompanySuppressed(Number(draft.company_id))) {
    throw new Error("Esta empresa pediu para não ser contatada.");
  }

  const edited = text !== draft.body ? 1 : 0;

  await updateMessageRepository(messageId, {
    body: text,
    status: "SENT",
    edited,
  });

  const prospect = await findProspectByCompanyRepository(
    Number(draft.company_id),
  );

  if (prospect) {
    await createActivityRepository(
      Number(prospect.id),
      "MESSAGE_SENT",
      text,
      "WHATSAPP",
      { author: "AI", edited: edited === 1 },
    );
  }
}

export async function discardDraft(messageId: number): Promise<void> {
  const draft = await getMessageRepository(messageId);

  if (!draft || draft.status !== "DRAFT") return;

  await updateMessageRepository(messageId, { status: "DISCARDED" });
}

export async function hasConversation(companyId: number): Promise<boolean> {
  return !!(await getConversationRepository(companyId));
}
