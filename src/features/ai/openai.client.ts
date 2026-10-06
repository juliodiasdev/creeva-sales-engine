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
    throw new Error(`OpenAI retornou ${response.status}.`);
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
