import { fetchByIds, getSupabase, unwrap } from "../../lib/store";

import { findProspectByCompanyRepository } from "../agent/agent.repository";
import { recordIncomingMessage } from "../agent/conversation.service";
import { looksLikeHardStop, suppressPhone } from "../compliance/suppression.service";

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
  /** Mensagens de números/empresas fora da abordagem (você decide). */
  unknown: number;
  failed: number;
}

let running: Promise<SyncResult> | null = null;

/**
 * Traz as respostas recebidas pelo webhook para o histórico de Conversas.
 * Passa pelo mesmo caminho de "colar resposta": o funil muda para Respondeu
 * e pedidos de parar suprimem a empresa na hora. Cada evento é tratado uma
 * única vez (reivindicado antes de processar) e só uma sincronização roda por vez.
 */
export function syncWhatsAppInbox(): Promise<SyncResult> {
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
  }

  return running;
}

async function runSync(): Promise<SyncResult> {
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
      // Pedido formal de parar vale para o NÚMERO, mesmo que não seja de nenhuma
      // empresa cadastrada: vai à lista de supressão antes de qualquer outra coisa.
      if (event.phone && event.body && looksLikeHardStop(event.body)) {
        await suppressPhone(
          phoneVariants(event.phone),
          "Pedido de parar recebido por WhatsApp",
        );
      }

      const companyId = event.phone ? await findCompanyByPhone(event.phone) : null;

      if (!companyId || !event.body) {
        await finish(event.id, 2, null);
        result.unknown++;
        continue;
      }

      // Empresa que ainda não está em abordagem: não há conversa para mostrar.
      if (!(await findProspectByCompanyRepository(companyId))) {
        await finish(event.id, 2, companyId);
        result.unknown++;
        continue;
      }

      await recordIncomingMessage(companyId, event.body, {
        receivedAt: event.event_at,
      });
      await finish(event.id, 1, companyId);
      result.imported++;
    } catch {
      await finish(event.id, 3, event.company_id);
      result.failed++;
    }
  }

  return result;
}

/** Mensagens que falharam ao importar (para tentar de novo). */
export async function countFailedMessages(): Promise<number> {
  const rows = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("id")
      .eq("direction", "IN")
      .eq("processed", 3),
  ) as { id: number }[];

  return rows.length;
}

/** Coloca as mensagens que falharam de volta na fila e sincroniza de novo. */
export async function retryFailedMessages(): Promise<SyncResult> {
  unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed: 0 })
      .eq("direction", "IN")
      .eq("processed", 3),
  );

  return syncWhatsAppInbox();
}

export interface DeliveryFailure {
  id: number;
  phone: string | null;
  reason: string | null;
}

/** Envios que a Meta avisou depois que NÃO foram entregues (número sem WhatsApp etc.). */
export async function listDeliveryFailures(): Promise<DeliveryFailure[]> {
  return unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("id,phone,body")
      .eq("direction", "STATUS")
      .eq("status", "failed")
      .eq("processed", 0)
      .order("id", { ascending: false })
      .limit(20),
  ).map((r: { id: number; phone: string | null; body: string | null }) => ({
    id: Number(r.id),
    phone: r.phone,
    reason: r.body,
  }));
}

export async function dismissDeliveryFailure(id: number): Promise<void> {
  unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed: 1 })
      .eq("id", id),
  );
}

/** Mensagens recebidas de números sem empresa (para você decidir). */
export type UnknownMessage = WhatsAppEvent & { company_name: string | null };

export async function listUnknownMessages(limit = 20): Promise<UnknownMessage[]> {
  const rows = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("*")
      .eq("direction", "IN")
      .eq("processed", 2)
      .order("id", { ascending: false })
      .limit(limit),
  ) as WhatsAppEvent[];

  const ids = [...new Set(rows.map((r) => Number(r.company_id)).filter(Boolean))];
  const companies = ids.length
    ? await fetchByIds<{ id: number; name: string }>("companies", "id,name", "id", ids)
    : [];

  return rows.map((r) => ({
    ...r,
    company_name: companies.find((c) => Number(c.id) === Number(r.company_id))?.name ?? null,
  }));
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
