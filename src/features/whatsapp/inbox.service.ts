import { fetchByIds, getSupabase, nowIso, unwrap } from "../../lib/store";

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
  attempts?: number;
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

/**
 * processed: 0 novo · 4 em processamento · 1 tratado · 2 fora da abordagem · 3 falhou (3 tentativas)
 * "Em processamento" tem prazo: se o app fechar no meio, o evento volta para a fila.
 */
const CLAIM_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

async function claim(id: number): Promise<boolean> {
  const rows = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed: 4, claimed_at: nowIso() })
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
      .update({ processed, company_id: companyId, claimed_at: null })
      .eq("id", id),
  );
}

/** Falhou: tenta de novo nos próximos ciclos; só depois de 3 tentativas vira "falhou". */
async function fail(event: WhatsAppEvent & { attempts?: number }) {
  const attempts = Number(event.attempts ?? 0) + 1;

  unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({
        processed: attempts >= MAX_ATTEMPTS ? 3 : 0,
        attempts,
        claimed_at: null,
      })
      .eq("id", event.id),
  );

  return attempts >= MAX_ATTEMPTS;
}

/** Devolve à fila o que ficou "em processamento" por mais que o prazo. */
async function releaseStaleClaims(): Promise<void> {
  unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .update({ processed: 0, claimed_at: null })
      .eq("processed", 4)
      .lt("claimed_at", new Date(Date.now() - CLAIM_TTL_MS).toISOString()),
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
  await releaseStaleClaims();

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
      // Só conta como falha definitiva depois das tentativas; antes disso volta à fila.
      if (await fail(event).catch(() => false)) result.failed++;
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
      .update({ processed: 0, attempts: 0 })
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

/** O número desconhecido pediu para parar: suprime o telefone e tira a mensagem da lista. */
export async function suppressUnknownMessage(id: number): Promise<void> {
  const rows = unwrap(
    await getSupabase().from("whatsapp_events").select("phone").eq("id", id).limit(1),
  ) as { phone: string | null }[];

  if (rows[0]?.phone) {
    await suppressPhone(phoneVariants(rows[0].phone), "Pedido de parar recebido por WhatsApp");
  }

  await dismissUnknownMessage(id);
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

/** A janela abre quando o CONTATO escreve (para a Meta): vale o horário real do evento. */
export function windowOpenFromInbound(
  lastInboundAt: string | null,
  now = new Date(),
): boolean {
  if (!lastInboundAt) return false;

  const age = now.getTime() - new Date(lastInboundAt).getTime();

  return age >= 0 && age < SERVICE_WINDOW_HOURS * 3_600_000;
}

/**
 * Última mensagem que a Meta recebeu desta empresa. Respostas coladas à mão ou
 * registros de ligação NÃO abrem a janela: só o que chegou pelo WhatsApp oficial.
 */
export async function lastInboundAt(companyId: number): Promise<string | null> {
  const rows = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("event_at,created_at")
      .eq("direction", "IN")
      .eq("company_id", companyId)
      .order("id", { ascending: false })
      .limit(1),
  ) as { event_at: string | null; created_at: string }[];

  return rows[0] ? (rows[0].event_at ?? rows[0].created_at) : null;
}

/** Quando chegou o último evento do webhook (prova de que o recebimento funciona). */
export async function lastWebhookEventAt(): Promise<string | null> {
  const rows = unwrap(
    await getSupabase()
      .from("whatsapp_events")
      .select("created_at")
      .in("direction", ["IN", "STATUS"])
      .order("id", { ascending: false })
      .limit(1),
  ) as { created_at: string }[];

  return rows[0]?.created_at ?? null;
}

/** Marcador de mídia sem texto: o conteúdo real só se vê no WhatsApp. */
export const isMediaPlaceholder = (body: string): boolean =>
  /^\[[^\]]*(recebid[ao]|abra no WhatsApp)[^\]]*\]$/i.test(body.trim());
