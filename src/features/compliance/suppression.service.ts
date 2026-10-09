import { fetchAllPages, fetchByIds, getSupabase, unwrap } from "../../lib/store";

import { getCompanyRepository } from "../companies/company.repository";
import type { Company } from "../companies/company.types";
import {
  listChannelsForCompanies,
  listChannelsRepository,
} from "../contacts/channels.repository";
import type { StoredChannel } from "../contacts/channels.repository";

/**
 * PLACE (id do Google) e NAME (nome+endereço) identificam a empresa mesmo sem
 * telefone/e-mail/site/CNPJ e não dependem do id interno (que se repete após
 * um reset ou restauração de backup).
 */
export type SuppressionKind =
  | "PHONE"
  | "EMAIL"
  | "DOMAIN"
  | "CNPJ"
  | "PLACE"
  | "NAME";

export interface Suppression {
  id: number;
  kind: SuppressionKind;
  value: string;
  reason: string | null;
  created_at: string;
}

interface Identifier {
  kind: SuppressionKind;
  value: string;
}

/** Identificadores reais da empresa (função pura, usada em lote e individual). */
export function identifiersFrom(
  company: Company,
  channels: Pick<StoredChannel, "kind" | "value">[],
): Identifier[] {
  const ids = new Map<string, Identifier>();

  const add = (kind: SuppressionKind, value: string | null | undefined) => {
    const v = value?.trim().toLowerCase();

    if (v) ids.set(`${kind}:${v}`, { kind, value: v });
  };

  add("PLACE", company.google_place_id);
  // Sem endereço não há dedupe_key: nome+cidade garante proteção mínima.
  add(
    "NAME",
    company.dedupe_key ??
      `${company.name}|${company.city ?? ""}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " "),
  );
  add("PHONE", company.phone_normalized);
  add("DOMAIN", company.domain);
  add("CNPJ", company.cnpj?.replace(/\D/g, ""));

  for (const c of channels) {
    if (c.kind === "PHONE" || c.kind === "WHATSAPP") {
      if (/^\d+$/.test(c.value)) add("PHONE", c.value);
    } else if (c.kind === "EMAIL") {
      add("EMAIL", c.value);
    }
  }

  return [...ids.values()];
}

async function identifiersOf(companyId: number): Promise<Identifier[]> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  return identifiersFrom(company, await listChannelsRepository(companyId));
}

export async function listSuppressions(): Promise<Suppression[]> {
  return fetchAllPages<Suppression>((from, to) =>
    getSupabase()
      .from("suppressions")
      .select("*")
      .order("id", { ascending: false })
      .range(from, to) as never,
  );
}

/** Registra que esta empresa NÃO deve mais ser contatada (todos os identificadores). */
export async function suppressCompany(
  companyId: number,
  reason: string,
): Promise<number> {
  const rows = await identifiersOf(companyId);

  if (rows.length === 0) return 0;

  unwrap(
    await getSupabase()
      .from("suppressions")
      .upsert(
        rows.map((r) => ({ ...r, reason: reason.trim() || null })),
        { onConflict: "kind,value", ignoreDuplicates: true },
      ),
  );

  return rows.length;
}

/** A empresa (por qualquer identificador) está na lista de supressão? */
export async function isCompanySuppressed(
  companyId: number,
): Promise<boolean> {
  const rows = await identifiersOf(companyId);

  if (rows.length === 0) return false;

  const found = unwrap(
    await getSupabase()
      .from("suppressions")
      .select("kind,value")
      .in(
        "value",
        rows.map((r) => r.value),
      ),
  ) as { kind: SuppressionKind; value: string }[];

  return found.some((f) =>
    rows.some((r) => r.kind === f.kind && r.value === f.value),
  );
}

/** Versão em lote (listas e telas com muitas empresas): quais estão suprimidas? */
export async function suppressedCompanyIds(
  companyIds: number[],
): Promise<Set<number>> {
  if (companyIds.length === 0) return new Set();

  const [suppressions, companies, channels] = await Promise.all([
    listSuppressions(),
    fetchByIds<Company>("companies", "*", "id", companyIds),
    listChannelsForCompanies(companyIds),
  ]);

  if (suppressions.length === 0) return new Set();

  const blocked = new Set(suppressions.map((s) => `${s.kind}:${s.value}`));
  const result = new Set<number>();

  for (const company of companies) {
    const mine = channels.filter(
      (c) => Number(c.company_id) === Number(company.id),
    );

    if (
      identifiersFrom(company, mine).some((i) =>
        blocked.has(`${i.kind}:${i.value}`),
      )
    ) {
      result.add(Number(company.id));
    }
  }

  return result;
}

/**
 * Pedido FORMAL e inequívoco de parar: vira supressão automática. Só frases
 * que ninguém usa numa conversa comercial normal entram aqui; o resto é
 * apenas alerta (SOFT_NO) para o vendedor decidir.
 */
const HARD_STOP =
  /\b(descadastr\w*|me (tire|tira|retire|retira|remova|remove|exclua|exclui) da lista|sair da lista|(pare|parem|para) de (me |nos )?(mandar|enviar|chamar|ligar|escrever|incomodar|procurar)|n[ãa]o (me |nos )?(chame|chamem|mande|mandem|envie|enviem|ligue|liguem|escreva|escrevam|procure|procurem|incomode|incomodem)( mais)?|(j[áa] )?pedi (pra|para) (voc[êe]s? )?parar|nunca mais (me |nos )?(escreva|mande|envie|chame|ligue)|chega de (mensage(m|ns)|liga[çc][õo]es|contatos?)|n[ãa]o (quero|desejo) (mais )?(receber|mensage(m|ns)|contato)|(me |nos )?deixa(m)? (a gente |eu )?em paz|tir[ea] (o |meu |o meu )(n[úu]mero|contato))/i;

/** Respostas curtas e inequívocas ("PARE", "SAIR"). */
const HARD_STOP_SHORT =
  /^\s*(pare|parar|parem|chega|sair|stop|cancelar|descadastrar)\W*$/i;

/** Recusa ou possível pedido de parar: alerta e bloqueio do rascunho, sem supressão automática. */
const SOFT_NO =
  /\b(n[ãa]o (quero|tenho interesse|precisamos|precisa mandar)|sem interesse|agora n[ãa]o|j[áa] tenho (site|sistema|fornecedor)|pode parar|podem parar|para com isso|pare\b|parar de|spam|denunci\w*|lgpd|bloque(ar|ei|ando)|n[ãa]o precisa (mais )?(mandar|enviar))/i;

const norm = (text: string) => text.normalize("NFC");

export function looksLikeHardStop(text: string): boolean {
  const t = norm(text);

  return HARD_STOP.test(t) || HARD_STOP_SHORT.test(t);
}

export function looksLikeSoftNo(text: string): boolean {
  return SOFT_NO.test(norm(text));
}

/** Qualquer sinal de recusa (alerta na tela; o rascunho fica bloqueado). */
export function looksLikeOptOut(text: string): boolean {
  return looksLikeHardStop(text) || looksLikeSoftNo(text);
}

/** Algum OUTRO registro usa o mesmo identificador (telefone, domínio, e-mail, CNPJ)? */
async function sharedWithOthers(
  kind: SuppressionKind,
  value: string,
  companyId: number,
): Promise<boolean> {
  const supabase = getSupabase();

  const column =
    kind === "PHONE"
      ? "phone_normalized"
      : kind === "DOMAIN"
        ? "domain"
        : kind === "CNPJ"
          ? "cnpj"
          : kind === "PLACE"
            ? "google_place_id"
            : kind === "NAME"
              ? "dedupe_key"
              : null;

  if (column) {
    const rows = unwrap(
      await supabase
        .from("companies")
        .select("id")
        .eq(column, value)
        .neq("id", companyId)
        .limit(1),
    ) as unknown[];

    if (rows.length > 0) return true;
  }

  const kinds =
    kind === "PHONE" ? ["PHONE", "WHATSAPP"] : kind === "EMAIL" ? ["EMAIL"] : [];

  if (kinds.length > 0) {
    const rows = unwrap(
      await supabase
        .from("company_channels")
        .select("id")
        .in("kind", kinds)
        .eq("value", value)
        .neq("company_id", companyId)
        .limit(1),
    ) as unknown[];

    if (rows.length > 0) return true;
  }

  return false;
}

/**
 * Desfaz uma supressão feita por engano. Identificadores que outra empresa
 * também usa (mesmo telefone, site...) continuam suprimidos: não é seguro
 * reabrir o contato de quem pode ser o mesmo negócio. Devolve true quando
 * a empresa AINDA fica bloqueada por causa desses identificadores.
 */
export async function unsuppressCompany(companyId: number): Promise<boolean> {
  const rows = await identifiersOf(companyId);

  for (const r of rows) {
    if (await sharedWithOthers(r.kind, r.value, companyId)) continue;

    unwrap(
      await getSupabase()
        .from("suppressions")
        .delete()
        .eq("kind", r.kind)
        .eq("value", r.value),
    );
  }

  return isCompanySuppressed(companyId);
}
