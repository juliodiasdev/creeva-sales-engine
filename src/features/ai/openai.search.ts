import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";
import { getSetting } from "../settings/settings.service";

import { describeOpenAiError } from "./openai.client";

export interface WebSearchResult {
  /** Texto final do modelo (esperado: JSON). */
  text: string;
  /** Páginas que a busca na web realmente retornou e o modelo citou. */
  citations: string[];
  searches: number;
  model: string;
}

export type WebSearch = (
  system: string,
  user: string,
) => Promise<WebSearchResult>;

interface ResponsesBody {
  output?: {
    type: string;
    content?: {
      type: string;
      text?: string;
      annotations?: { type: string; url?: string }[];
    }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Lê a resposta da Responses API: texto, páginas citadas e nº de buscas. */
export function parseResponses(data: ResponsesBody): Omit<WebSearchResult, "model"> {
  let text = "";
  const citations: string[] = [];
  let searches = 0;

  for (const item of data.output ?? []) {
    if (item.type === "web_search_call") searches++;

    if (item.type !== "message") continue;

    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text) text += part.text;

      for (const a of part.annotations ?? []) {
        if (a.type === "url_citation" && a.url) citations.push(a.url);
      }
    }
  }

  return { text, citations: [...new Set(citations)], searches };
}

/**
 * Pesquisa na web pela OpenAI (Responses API + ferramenta web_search).
 * A busca é obrigatória (tool_choice "required"): o modelo não responde "de cabeça".
 */
export const openaiWebSearch: WebSearch = async (system, user) => {
  const apiKey = await getSetting("openai_api_key");

  if (!apiKey) throw new Error("Configure a chave da OpenAI em Configurações.");

  const model = (await getSetting("openai_search_model")) ?? "gpt-4o-mini";

  const response = await httpFetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      max_output_tokens: 2500,
    }),
  });

  if (!response.ok) {
    const message = await describeOpenAiError(response);

    throw new Error(
      response.status === 400 || response.status === 404
        ? `${message} Se o modelo não aceitar busca na web, troque o "Modelo OpenAI para busca na web" em Configurações.`
        : message,
    );
  }

  const data = (await response.json()) as ResponsesBody;
  const parsed = parseResponses(data);

  await recordApiUsage({
    provider: "OPENAI",
    operation: "responses.web_search",
    requests: Math.max(parsed.searches, 1),
    tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  });

  if (!parsed.text) throw new Error("A OpenAI não devolveu resposta da busca.");

  return { ...parsed, model };
};
