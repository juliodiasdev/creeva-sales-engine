import type {
  TaskType,
} from "../tasks/task.types";

interface TemplateInput {
  taskType: TaskType;

  companyName: string;
  segment: string | null;
  city: string | null;
}

/**
 * Templates determinísticos. Não afirmam nenhuma análise
 * da empresa: só usam dados cadastrados (nome, segmento, cidade).
 */
export function buildOutreachMessage(
  input: TemplateInput,
): string {
  const place = input.city
    ? ` em ${input.city}`
    : "";

  const audience = input.segment
    ? ` para o segmento de ${input.segment}`
    : "";

  if (input.taskType === "FOLLOW_UP") {
    return [
      "Olá! Tudo bem?",
      "",
      `Passando para retomar minha mensagem anterior sobre a ${input.companyName}.`,
      "Se fizer sentido, posso te explicar rapidamente como a Creava Digital ajuda empresas a atrair e converter mais clientes pela internet.",
      "",
      "Prefere que eu envie mais detalhes por aqui?",
    ].join("\n");
  }

  return [
    "Olá! Tudo bem?",
    "",
    `Sou da Creava Digital. Trabalhamos com presença digital e geração de clientes${audience}${place}.`,
    `Gostaria de entender como a ${input.companyName} atrai novos clientes hoje e ver se faz sentido conversarmos.`,
    "",
    "Posso te enviar mais detalhes?",
  ].join("\n");
}
