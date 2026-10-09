import { fetchAllPages, getSupabase, unwrap } from "../../lib/store";

import { getCompanyRepository } from "../companies/company.repository";
import { listChannelsRepository } from "../contacts/channels.repository";

export type SuppressionKind = "PHONE" | "EMAIL" | "DOMAIN" | "CNPJ" | "COMPANY";

export interface Suppression {
  id: number;
  kind: SuppressionKind;
  value: string;
  reason: string | null;
  created_at: string;
}

/** Identificadores reais da empresa (telefones, e-mails, domínio, CNPJ). */
async function identifiersOf(
  companyId: number,
): Promise<{ kind: SuppressionKind; value: string }[]> {
  const company = await getCompanyRepository(companyId);

  if (!company) throw new Error("Empresa não encontrada.");

  const channels = await listChannelsRepository(companyId);
  const ids = new Map<string, { kind: SuppressionKind; value: string }>();

  const add = (kind: SuppressionKind, value: string | null | undefined) => {
    const v = value?.trim().toLowerCase();

    if (v) ids.set(`${kind}:${v}`, { kind, value: v });
  };

  // Garante proteção mesmo sem telefone, e-mail, site ou CNPJ.
  add("COMPANY", String(companyId));
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

/**
 * Pedido FORMAL de parar (LGPD/WhatsApp): vira supressão automática, sem
 * depender de ninguém lembrar. Só frases inequívocas entram aqui.
 */
const HARD_STOP =
  /\b(descadastr\w*|pare de|parem de|pode parar|favor parar|para de (me )?(mandar|enviar|chamar|ligar)|n[ãa]o (me )?(chame|mande|envie|ligue|procure)( mais)?|me (tire|retire|remova|exclua)\b|remov\w+ (meu|o meu) (n[úu]mero|contato|cadastro)|sair da lista|spam|denunci\w*|lgpd|bloque(ar|ei|ando)|chega de|parem|n[ãa]o (quero|desejo) (mais )?(receber|mensagens?|contato)|n[ãa]o me incomod\w*|(me )?deixa(m)? (a gente |eu )?em paz|tir\w+ (meu|o meu) (n[úu]mero|contato))/i;

/** Recusa comercial: não é opt-out formal, só um alerta para você decidir. */
const SOFT_NO =
  /\b(n[ãa]o (quero|tenho interesse)|sem interesse|agora n[ãa]o|n[ãa]o precisamos|j[áa] tenho (site|sistema|fornecedor))/i;

export function looksLikeHardStop(text: string): boolean {
  return HARD_STOP.test(text);
}

export function looksLikeSoftNo(text: string): boolean {
  return SOFT_NO.test(text);
}

/** Qualquer sinal de recusa (alerta na tela; o rascunho fica bloqueado). */
export function looksLikeOptOut(text: string): boolean {
  return looksLikeHardStop(text) || looksLikeSoftNo(text);
}

/** Desfaz uma supressão feita por engano (remove os identificadores da empresa). */
export async function unsuppressCompany(companyId: number): Promise<void> {
  const rows = await identifiersOf(companyId);

  for (const r of rows) {
    unwrap(
      await getSupabase()
        .from("suppressions")
        .delete()
        .eq("kind", r.kind)
        .eq("value", r.value),
    );
  }
}
