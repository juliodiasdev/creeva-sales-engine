import { getSupabase, unwrap } from "../../lib/store";

import { recordIncomingMessage } from "../agent/conversation.service";

import { phoneVariants } from "./phone";

export interface WhatsAppEvent {
  id: number;
  wamid: string;
  direction: "IN" | "OUT" | "STATUS";
  status: string;
  phone: string | null;
  name: string | null;
  body: string | null;
  processed: number;
  company_id: number | null;
  event_at: string | null;
  created_at: string;
}

/** Empresa dona de um telefone (cadastro do Google ou canais encontrados). */
export async function findCompanyByPhone(phone: string): Promise<number | null> {
  const variants = phoneVariants(phone);

  if (variants.length === 0) return null;

  const supabase = getSupabase();

  const byCompany = unwrap(
    await supabase
      .from("companies")
      .select("id")
      .in("phone_normalized", variants)
      .order("id", { ascending: true })
      .limit(1),
  ) as { id: number }[];

  if (byCompany[0]) return Number(byCompany[0].id);

  const byChannel = unwrap(
    await supabase
      .from("company_channels")
      .select("company_id")
      .in("kind", ["WHATSAPP", "PHONE"])
      .in("value", variants)
      .order("id", { ascending: true })
      .limit(1),
  ) as { company_id: number }[];

  return byChannel[0] ? Number(byChannel[0].company_id) : null;
}

/** processed: 0 novo · 1 tratado · 2 sem empresa · 3 falhou */
async function claim(id: number): Promise<boolean> {
  const rows = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed: 1 })
      .eq("id", id)
      .eq("processed", 0)
      .select("id"),
  ) as { id: number }[];

  return rows.length > 0;
}

async function finish(id: number, processed: number, companyId: number | null) {
  unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed, company_id: companyId })
      .eq("id", id),
  );
}

export interface SyncResult {
  imported: number;
  /** Mensagens de números que não são de nenhuma empresa cadastrada. */
  unknown: number;
  failed: number;
}

/**
 * Traz as respostas recebidas pelo webhook para o histórico de Conversas.
 * Passa pelo mesmo caminho de "colar resposta": o funil muda para Respondeu
 * e pedidos de parar suprimem a empresa na hora. Cada evento é tratado uma
 * única vez (reivindicado antes de processar).
 */
export async function syncWhatsAppInbox(): Promise<SyncResult> {
  const pending = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("*")
      .eq("direction", "IN")
      .eq("processed", 0)
      .order("id", { ascending: true })
      .limit(200),
  ) as WhatsAppEvent[];

  const result: SyncResult = { imported: 0, unknown: 0, failed: 0 };

  for (const event of pending) {
    if (!(await claim(event.id))) continue;

    try {
      const companyId = event.phone ? await findCompanyByPhone(event.phone) : null;

      if (!companyId || !event.body) {
        await finish(event.id, 2, null);
        result.unknown++;
        continue;
      }

      await recordIncomingMessage(companyId, event.body);
      await finish(event.id, 1, companyId);
      result.imported++;
    } catch {
      await finish(event.id, 3, event.company_id);
      result.failed++;
    }
  }

  return result;
}

/** Mensagens recebidas de números sem empresa (para você decidir). */
export async function listUnknownMessages(limit = 20): Promise<WhatsAppEvent[]> {
  return unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("*")
      .eq("direction", "IN")
      .eq("processed", 2)
      .order("id", { ascending: false })
      .limit(limit),
  ) as WhatsAppEvent[];
}

/** Dispensa uma mensagem de número desconhecido (sai da lista). */
export async function dismissUnknownMessage(id: number): Promise<void> {
  unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed: 1 })
      .eq("id", id)
      .eq("processed", 2),
  );
}

/* ---------- janela de 24 horas para responder por texto livre ---------- */

export const SERVICE_WINDOW_HOURS = 24;

/**
 * A janela de atendimento abre quando o CONTATO escreve no WhatsApp. Registros
 * de ligação ("[Ligação] …") não abrem a janela.
 */
export function serviceWindowOpen(
  messages: { direction: string; body: string; created_at: string; status: string }[],
  now = new Date(),
): boolean {
  const lastIn = [...messages]
    .reverse()
    .find(
      (m) =>
        m.direction === "IN" &&
        m.status !== "DRAFT" &&
        !m.body.startsWith("[Ligação]"),
    );

  if (!lastIn) return false;

  return now.getTime() - new Date(lastIn.created_at).getTime() < SERVICE_WINDOW_HOURS * 3_600_000;
}
