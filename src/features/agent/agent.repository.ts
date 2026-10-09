import {
  fetchAllPages,
  getSupabase,
  nowIso,
  unwrap,
} from "../../lib/store";

import type {
  Conversation,
  ConversationMessage,
  DraftIntent,
  MessageAuthor,
  MessageDirection,
  MessageStatus,
} from "./agent.types";

export async function getOrCreateConversationRepository(
  companyId: number,
): Promise<Conversation> {
  const supabase = getSupabase();

  unwrap(
    await supabase
      .from("conversations")
      .upsert(
        { company_id: companyId },
        { onConflict: "company_id", ignoreDuplicates: true },
      ),
  );

  return unwrap(
    await supabase
      .from("conversations")
      .select("*")
      .eq("company_id", companyId)
      .single(),
  ) as Conversation;
}

export async function getConversationRepository(
  companyId: number,
): Promise<Conversation | null> {
  return unwrap(
    await getSupabase()
      .from("conversations")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle(),
  ) as Conversation | null;
}

export async function updateConversationRepository(
  conversationId: number,
  fields: Partial<Pick<Conversation, "opted_out" | "handoff_reason">>,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("conversations")
      .update({ ...fields, updated_at: nowIso() })
      .eq("id", conversationId),
  );
}

export async function insertMessageRepository(input: {
  conversationId: number;
  companyId: number;
  direction: MessageDirection;
  author: MessageAuthor;
  body: string;
  status: MessageStatus;
  intent?: DraftIntent | null;
  model?: string | null;
  evidenceUsed?: string[];
}): Promise<number> {
  const row = unwrap(
    await getSupabase()
      .from("conversation_messages")
      .insert({
        conversation_id: input.conversationId,
        company_id: input.companyId,
        direction: input.direction,
        author: input.author,
        body: input.body,
        status: input.status,
        intent: input.intent ?? null,
        model: input.model ?? null,
        evidence_used: input.evidenceUsed
          ? JSON.stringify(input.evidenceUsed)
          : null,
      })
      .select("id")
      .single(),
  ) as { id: number };

  await updateConversationRepository(input.conversationId, {});

  return Number(row.id);
}

export async function getMessageRepository(
  id: number,
): Promise<ConversationMessage | null> {
  return unwrap(
    await getSupabase()
      .from("conversation_messages")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  ) as ConversationMessage | null;
}

export async function updateMessageRepository(
  id: number,
  fields: Partial<Pick<ConversationMessage, "body" | "status" | "edited">>,
): Promise<void> {
  unwrap(
    await getSupabase()
      .from("conversation_messages")
      .update(fields)
      .eq("id", id),
  );
}

/** Mensagens da empresa em ordem cronológica (descartadas não aparecem). */
export async function listMessagesRepository(
  companyId: number,
): Promise<ConversationMessage[]> {
  const rows = await fetchAllPages<ConversationMessage>((from, to) =>
    getSupabase()
      .from("conversation_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  return rows.filter((m) => m.status !== "DISCARDED");
}

/** Todas as mensagens (somente o necessário para resumos e aprendizado). */
export async function listAllMessagesRepository(): Promise<
  Pick<
    ConversationMessage,
    "id" | "company_id" | "direction" | "author" | "body" | "status" | "edited" | "created_at"
  >[]
> {
  const rows = await fetchAllPages<
    Pick<
      ConversationMessage,
      "id" | "company_id" | "direction" | "author" | "body" | "status" | "edited" | "created_at"
    >
  >((from, to) =>
    getSupabase()
      .from("conversation_messages")
      .select("id,company_id,direction,author,body,status,edited,created_at")
      .order("id", { ascending: true })
      .range(from, to) as never,
  );

  return rows.filter((m) => m.status !== "DISCARDED");
}

export async function findProspectByCompanyRepository(
  companyId: number,
): Promise<{ id: number; status: string } | null> {
  return unwrap(
    await getSupabase()
      .from("prospects")
      .select("id,status")
      .eq("company_id", companyId)
      .maybeSingle(),
  ) as { id: number; status: string } | null;
}
