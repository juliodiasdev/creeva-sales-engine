import { fetchAllPages, getSupabase, unwrap } from "../../lib/store";

import { getCompanyRepository } from "../companies/company.repository";
import { listChannelsRepository } from "../contacts/channels.repository";

export type SuppressionKind = "PHONE" | "EMAIL" | "DOMAIN" | "CNPJ";

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
 * Sinais de que o contato pediu para parar. É só um ALERTA: quem decide
 * (e registra a supressão) é o usuário, para não bloquear por engano.
 */
const OPT_OUT =
  /\b(pare|parar|pode parar|para de (me )?(mandar|enviar|chamar)|n[ãa]o (me )?(chame|mande|envie|procure)|n[ãa]o (quero|tenho interesse)|sem interesse|me (tire|remova|exclua|retire)|remov(a|er) (meu|o meu)|sair da lista|descadastr\w*|spam|denunci\w*|bloque(ar|ei|ando))\b/i;

export function looksLikeOptOut(text: string): boolean {
  return OPT_OUT.test(text);
}
