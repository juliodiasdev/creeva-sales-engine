import { getDatabase } from "../../lib/database";
import { normalizeText } from "../../lib/normalize";

export const PLAYBOOK_SEGMENTS = [
  "odontologia",
  "advocacia",
  "imobiliária",
  "academia",
  "restaurante",
  "serviços locais",
] as const;

export const PLAYBOOK_KINDS = [
  "FIRST_CONTACT",
  "FOLLOW_UP_1",
  "FOLLOW_UP_2",
  "PROPOSAL_FOLLOW_UP",
  "REACTIVATION",
] as const;

export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number];

export interface PlaybookScript {
  id: number;
  segment: string;
  kind: PlaybookKind;
  title: string;
  body: string;
}

const AUDIENCE: Record<string, string> = {
  odontologia: "clínicas odontológicas captarem mais pacientes",
  advocacia: "escritórios de advocacia receberem mais consultas qualificadas",
  "imobiliária": "imobiliárias gerarem mais contatos de compradores e proprietários",
  academia: "academias atraírem novos alunos",
  restaurante: "restaurantes receberem mais pedidos e reservas",
  "serviços locais": "negócios locais serem encontrados por mais clientes",
};

// Textos neutros: não afirmam nenhuma análise da empresa.
function templates(segment: string): Record<PlaybookKind, string> {
  const audience = AUDIENCE[segment] ?? AUDIENCE["serviços locais"];

  return {
    FIRST_CONTACT: `Olá! Tudo bem?\n\nSou da {{agencia}}. Ajudamos ${audience} pela internet.\nGostaria de entender como a {{empresa}} atrai clientes hoje e ver se faz sentido conversarmos.\n\nPosso te enviar mais detalhes?`,
    FOLLOW_UP_1: `Olá! Passando para retomar minha mensagem sobre a {{empresa}}.\nSe fizer sentido, explico em poucos minutos como ajudamos ${audience}.\n\nPrefere que eu envie por aqui?`,
    FOLLOW_UP_2: `Oi! Última tentativa por aqui, sem querer incomodar.\nSe atrair mais clientes pela internet for uma prioridade para a {{empresa}}, fico à disposição. Caso contrário, sem problema!`,
    PROPOSAL_FOLLOW_UP: `Olá! Conseguiu avaliar a proposta que enviei para a {{empresa}}?\nFico à disposição para tirar dúvidas ou ajustar algum ponto.`,
    REACTIVATION: `Olá! Faz um tempo que conversamos sobre a {{empresa}}.\nSurgiram novidades por aqui e queria saber se atrair mais clientes pela internet voltou a ser uma prioridade.`,
  };
}

export async function ensurePlaybookSeed(): Promise<void> {
  const db = await getDatabase();

  const [{ n }] = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM playbook_scripts`,
  );

  if (n > 0) return;

  for (const segment of PLAYBOOK_SEGMENTS) {
    const t = templates(segment);

    for (const kind of PLAYBOOK_KINDS) {
      await db.execute(
        `INSERT INTO playbook_scripts (segment, kind, title, body) VALUES ($1,$2,$3,$4)`,
        [segment, kind, `${segment} — ${kind}`, t[kind]],
      );
    }
  }
}

export async function listScripts(): Promise<PlaybookScript[]> {
  const db = await getDatabase();

  return db.select<PlaybookScript[]>(
    `SELECT id, segment, kind, title, body FROM playbook_scripts ORDER BY segment, id`,
  );
}

export async function updateScript(
  id: number,
  body: string,
): Promise<void> {
  if (!body.trim()) throw new Error("O script não pode ficar vazio.");

  const db = await getDatabase();

  await db.execute(
    `UPDATE playbook_scripts SET body = $2 WHERE id = $1`,
    [id, body.trim()],
  );
}

export function renderScript(
  body: string,
  vars: { empresa: string; agencia: string; cidade?: string | null; vendedor?: string },
): string {
  const map: Record<string, string> = {
    empresa: vars.empresa,
    agencia: vars.agencia,
    cidade: vars.cidade ?? "",
    vendedor: vars.vendedor ?? "",
  };

  return body.replace(/\{\{(\w+)\}\}/g, (m, key: string) =>
    key in map ? map[key] : m,
  );
}

/** Script do segmento; cai em "serviços locais" quando não há match. */
export async function findScript(
  segment: string | null,
  kind: PlaybookKind,
): Promise<PlaybookScript | null> {
  const db = await getDatabase();

  const wanted = normalizeText(segment);

  const scripts = await db.select<PlaybookScript[]>(
    `SELECT id, segment, kind, title, body FROM playbook_scripts WHERE kind = $1`,
    [kind],
  );

  return (
    scripts.find((s) => wanted && wanted.includes(normalizeText(s.segment))) ??
    scripts.find((s) => s.segment === "serviços locais") ??
    null
  );
}
