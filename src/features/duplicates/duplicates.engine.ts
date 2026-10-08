import { normalizeText } from "../../lib/normalize";

export interface CompanyBrief {
  id: number;
  name: string;
  city: string | null;
  address: string | null;
  phone_normalized: string | null;
  domain: string | null;
  cnpj: string | null;
  google_place_id: string | null;
  website: string | null;
  phone: string | null;
  lead_status: string;
}

export interface DuplicateGroup {
  members: CompanyBrief[];
  reasons: string[];
}

const STOP_WORDS = new Set([
  "ltda", "me", "eireli", "epp", "sa", "de", "da", "do", "das", "dos", "e",
]);

function nameTokens(name: string): string[] {
  return normalizeText(name)
    .split(" ")
    .filter((t) => t && !STOP_WORDS.has(t));
}

function bigrams(text: string): string[] {
  const t = text.replace(/\s+/g, "");
  const out: string[] = [];

  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));

  return out;
}

/** Coeficiente de Dice sobre bigramas (0–1). */
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(nameTokens(a).join(" "));
  const y = bigrams(nameTokens(b).join(" "));

  if (x.length === 0 || y.length === 0) return 0;

  const counts = new Map<string, number>();

  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);

  let overlap = 0;

  for (const g of y) {
    const c = counts.get(g) ?? 0;

    if (c > 0) {
      overlap++;
      counts.set(g, c - 1);
    }
  }

  return (2 * overlap) / (x.length + y.length);
}

function isSubset(a: string[], b: string[]): boolean {
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];

  return small.length >= 2 && small.every((t) => big.includes(t));
}

const SIMILARITY_THRESHOLD = 0.82;

/**
 * Gera grupos de PROVÁVEIS duplicados de forma determinística.
 * Nada é mesclado aqui: o usuário (e opcionalmente a IA) confirma.
 */
export function findDuplicateGroups(
  companies: CompanyBrief[],
): DuplicateGroup[] {
  const parent = new Map<number, number>();
  const reasons = new Map<number, Set<string>>();

  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };

  for (const c of companies) parent.set(c.id, c.id);

  const link = (a: CompanyBrief, b: CompanyBrief, reason: string) => {
    const ra = find(a.id);
    const rb = find(b.id);

    if (ra !== rb) parent.set(ra, rb);

    const root = find(a.id);
    const set = reasons.get(root) ?? new Set<string>();
    reasons.forEach((v, k) => {
      if (k === ra || k === rb) v.forEach((r) => set.add(r));
    });
    set.add(reason);
    reasons.set(root, set);
  };

  // 1) chaves fortes iguais (legado / dados importados sem checagem)
  const strong: [keyof CompanyBrief, string][] = [
    ["google_place_id", "mesmo Google Place"],
    ["cnpj", "mesmo CNPJ"],
    ["domain", "mesmo site"],
    ["phone_normalized", "mesmo telefone"],
  ];

  for (const [key, label] of strong) {
    const seen = new Map<string, CompanyBrief>();

    for (const c of companies) {
      const value = c[key];

      if (!value) continue;

      const first = seen.get(String(value));

      if (first) link(first, c, label);
      else seen.set(String(value), c);
    }
  }

  // 2) nomes parecidos na mesma cidade (blocos por cidade)
  const byCity = new Map<string, CompanyBrief[]>();

  for (const c of companies) {
    const key = normalizeText(c.city) || "_";
    byCity.set(key, [...(byCity.get(key) ?? []), c]);
  }

  for (const [city, list] of byCity) {
    if (city === "_") continue;

    const tokens = list.map((c) => nameTokens(c.name));

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (find(list[i].id) === find(list[j].id)) continue;

        const similar =
          nameSimilarity(list[i].name, list[j].name) >=
            SIMILARITY_THRESHOLD ||
          isSubset(tokens[i], tokens[j]);

        if (similar) link(list[i], list[j], "nome parecido na mesma cidade");
      }
    }
  }

  const groups = new Map<number, CompanyBrief[]>();

  for (const c of companies) {
    const root = find(c.id);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => ({
      members: members.sort((a, b) => a.id - b.id),
      reasons: [...(reasons.get(root) ?? [])],
    }));
}
