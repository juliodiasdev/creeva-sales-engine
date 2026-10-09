import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";
import { getSetting } from "../settings/settings.service";

export interface ClaudeTurn {
  role: "user" | "assistant";
  content: string;
}

/** Uma chamada ao Claude que devolve JSON (system separado do histórico). */
export type ClaudeChatJson = (
  system: string,
  turns: ClaudeTurn[],
) => Promise<{ json: unknown; model: string }>;

/** Traduz erros da Anthropic em orientação acionável. */
export async function describeAnthropicError(
  response: Response,
): Promise<string> {
  let detail = "";

  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };

    detail = body.error?.message ?? "";
  } catch {
    // corpo não-JSON
  }

  let hint = "erro inesperado.";

  if (response.status === 401) {
    hint = "Chave inválida. Gere uma chave em console.anthropic.com → API keys.";
  } else if (response.status === 402 || /credit|billing/i.test(detail)) {
    hint = "Sem crédito: adicione saldo em console.anthropic.com → Billing.";
  } else if (response.status === 429) {
    hint = "Limite de requisições excedido. Tente novamente em instantes.";
  } else if (response.status === 404) {
    hint = "Modelo indisponível para a sua conta. Troque o modelo em Configurações.";
  } else if (response.status === 403) {
    hint = "Acesso negado para este modelo/projeto.";
  } else if (response.status === 529) {
    hint = "Serviço sobrecarregado. Tente novamente em instantes.";
  }

  return `Claude (${response.status}): ${hint}${detail ? ` Detalhe: ${detail}` : ""}`;
}

/** Extrai o objeto JSON de uma resposta de texto (aceita cercas ```json). */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(body);
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1));
      } catch {
        // cai no erro abaixo
      }
    }

    throw new Error("O Claude não retornou JSON válido.");
  }
}

const MAX_TOKENS = 4096;
const RETRY_STATUS = [429, 500, 502, 503, 529];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const claudeChatJson: ClaudeChatJson = async (system, turns) => {
  const apiKey = await getSetting("anthropic_api_key");

  if (!apiKey) {
    throw new Error("Configure a chave da Anthropic (Claude) em Configurações.");
  }

  const model = (await getSetting("anthropic_model")) ?? "claude-sonnet-5-5";

  const send = () =>
    httpFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        // O raciocínio do modelo também consome max_tokens: folga evita resposta cortada.
        max_tokens: MAX_TOKENS,
        system,
        messages: turns,
      }),
    });

  // Até 3 tentativas em limite de requisições / sobrecarga / erro do servidor.
  let response = await send();

  for (let attempt = 1; attempt < 3 && RETRY_STATUS.includes(response.status); attempt++) {
    await sleep(attempt * 1500);
    response = await send();
  }

  if (!response.ok) {
    throw new Error(await describeAnthropicError(response));
  }

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  // O custo em dinheiro não é estimado: só tokens reais informados pela API.
  await recordApiUsage({
    provider: "ANTHROPIC",
    operation: "messages",
    tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  });

  // Recusa ou resposta cortada nunca viram rascunho: o humano assume.
  if (data.stop_reason === "refusal") {
    throw new Error("O Claude recusou responder a esta mensagem. Escreva você mesmo.");
  }

  if (data.stop_reason === "max_tokens") {
    throw new Error("A resposta do Claude foi cortada. Tente gerar de novo.");
  }

  const text = data.content
    ?.filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");

  if (!text) throw new Error("Resposta vazia do Claude.");

  return { json: parseJsonText(text), model };
};

/** Chamada mínima só para validar chave, saldo e modelo. */
export async function testClaudeConnection(): Promise<string> {
  const { json, model } = await claudeChatJson(
    "Responda apenas com JSON.",
    [{ role: "user", content: 'Responda {"ok": true}' }],
  );

  return (json as { ok?: boolean })?.ok === true
    ? `Conexão OK com o modelo ${model}.`
    : `A API respondeu (modelo ${model}), mas com conteúdo inesperado.`;
}
