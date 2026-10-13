const NUMBER_WORD =
  "um|dois|tr[êe]s|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|quarenta|cinquenta|cem|cento|duzent\\w+|quinhent\\w+|mil";

const MONEY = new RegExp(
  [
    "r\\$",
    "us\\$",
    "\\bd[óo]lar(es)?\\b",
    `(\\d|\\b(${NUMBER_WORD})\\b)\\s*(mil\\s*)?(reais|real)\\b`,
    "\\d\\s*(mil|k)\\b",
    "\\d\\s*%",
    "\\bpor ?cento\\b",
    // 1.500,00 · 2000/mês · por mês · mensalidade
    "\\b\\d{1,3}(\\.\\d{3})+(,\\d{2})?\\b",
    "\\d\\s*(\\/|por )\\s*m[êe]s",
    "\\bmensalidade\\b|\\bvalor mensal\\b|\\binvestimento de\\b",
  ].join("|"),
  "i",
);

const LINK =
  /https?:\/\/|www\.|\b[\w-]+\.(com|net|org|io|app|me|ly|co|br|dev|site|store)\b/i;

const PHONE = /(\d[\s().-]?){8,}/;

/**
 * Regras de conteúdo para qualquer texto que a IA escreva para um lead:
 * nada de preço/porcentagem inventados, links ou telefones.
 * Devolve a mensagem de erro, ou null se o texto está limpo.
 */
export function forbiddenContent(text: string): string | null {
  if (MONEY.test(text)) {
    return "cita valores em dinheiro ou porcentagens: não informe preços nem números que não estejam nos dados; proponha uma conversa para entender o escopo.";
  }

  if (LINK.test(text)) {
    return "contém link ou endereço de site: não envie links.";
  }

  if (PHONE.test(text)) {
    return "contém um número de telefone: não informe contatos.";
  }

  return null;
}
