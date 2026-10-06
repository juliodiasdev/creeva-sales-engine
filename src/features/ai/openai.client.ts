import { httpFetch } from "../../lib/http";
import { recordApiUsage } from "../jobs/apiUsage.service";
import { getSetting } from "../settings/settings.service";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export type ChatJson = (
  messages: ChatMessage[],
) => Promise<{ json: unknown; model: string }>;

// USD por 1M tokens (aproximação para estimativa de custo).
const PRICING: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
};

/** Traduz erros da OpenAI em orientação acionável. */
export async function describeOpenAiError(
  response: Response,
): Promise<string> {
  let code = "";
  let detail = "";

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    code = body.error?.code ?? "";
    detail = body.error?.message ?? "";
  } catch {
    // corpo não-JSON
  }

  let hint = "erro inesperado.";

  if (response.status === 401) {
    hint = "Chave inválida. Gere uma chave em platform.openai.com/api-keys.";
  } else if (code === "insufficient_quota") {
    hint = "Sem crédito: adicione saldo em platform.openai.com → Billing.";
  } else if (response.status === 429) {
    hint = "Limite de requisições excedido. Tente novamente em instantes.";
  } else if (response.status === 404 || code === "model_not_found") {
    hint = "Modelo indisponível para a sua conta. Troque o modelo em Settings.";
  } else if (response.status === 403) {
    hint = "Acesso negado para este modelo/projeto.";
  }

  return `OpenAI (${response.status}): ${hint}${detail ? ` Detalhe: ${detail}` : ""}`;
}

/** Chamada mínima só para validar chave, saldo e modelo. */
export async function testOpenAiConnection(): Promise<string> {
  const { json, model } = await openaiChatJson([
    { role: "system", content: "Responda apenas com JSON." },
    { role: "user", content: 'Responda {"ok": true}' },
  ]);

  const ok = (json as { ok?: boolean })?.ok === true;

  return ok
    ? `Conexão OK com o modelo ${model}.`
    : `A API respondeu (modelo ${model}), mas com conteúdo inesperado.`;
}

export const openaiChatJson: ChatJson = async (messages) => {
  const apiKey = await getSetting("openai_api_key");

  if (!apiKey) {
    throw new Error("Configure a chave da OpenAI em Settings.");
  }

  const model = (await getSetting("openai_model")) ?? "gpt-4o-mini";

  const response = await httpFetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await describeOpenAiError(response));
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const [pin, pout] = PRICING[model] ?? [0, 0];

  await recordApiUsage({
    provider: "OPENAI",
    operation: "chat.completions",
    tokens: promptTokens + completionTokens,
    estimatedCost:
      (promptTokens * pin + completionTokens * pout) / 1_000_000,
  });

  const content = data.choices?.[0]?.message?.content;

  if (!content) throw new Error("Resposta vazia da OpenAI.");

  try {
    return { json: JSON.parse(content), model };
  } catch {
    throw new Error("A OpenAI não retornou JSON válido.");
  }
};
