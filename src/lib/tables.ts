/**
 * Tabelas e colunas aceitas em backup/restauração. Deve refletir
 * supabase/schema.sql (há um teste que garante isso).
 */
export const TABLE_COLUMNS: Record<string, string[]> = {
  lists: ["id","name","segment","city","neighborhood","query_text","pages","status","found","imported","duplicates","already_seen","notes","created_at","updated_at"],
  companies: ["id","name","segment","city","state","website","phone","instagram","google_place_id","cnpj","legal_name","cnae","company_size","registration_status","opened_at","capital","address","category","rating","reviews_count","domain","phone_normalized","dedupe_key","lead_status","disqualified_reason","list_id","maps_url","business_status","created_at","updated_at"],
  company_sources: ["id","company_id","source_type","source_id","raw_data","created_at"],
  website_snapshots: ["id","company_id","url","facts","fetched_at"],
  signals: ["id","company_id","type","value","evidence","source","confidence","created_at"],
  company_scores: ["id","company_id","fit","need","capacity","intent","total","confidence","reasons","created_at"],
  ai_analyses: ["id","company_id","summary","main_problem","opportunity","recommended_offer","outreach_angle","confidence","model","recommended_services","bottlenecks","created_at"],
  prospects: ["id","company_id","status","priority","score","next_action","next_action_at","qualification_notes","lost_reason","closed_at","created_at","updated_at"],
  tasks: ["id","prospect_id","type","title","description","priority","due_at","completed_at","outcome","created_at"],
  activities: ["id","prospect_id","type","channel","content","metadata","occurred_at"],
  deals: ["id","prospect_id","service_type","title","value","probability","status","expected_close_at","closed_at","recurring","lost_reason","created_at","updated_at"],
  meetings: ["id","prospect_id","scheduled_at","notes","need","budget","decision_maker","timeline","created_at"],
  proposals: ["id","deal_id","prospect_id","value","description","sent_at","valid_until","created_at"],
  playbook_scripts: ["id","segment","kind","title","body","created_at"],
  services: ["id","key","name","description","pain_points","active","sort","created_at"],
  company_channels: ["id","company_id","kind","value","url","label","source","created_at"],
  company_approaches: ["id","company_id","channel","service_key","angle","message","evidence_used","source","created_at"],
  conversations: ["id","company_id","opted_out","handoff_reason","created_at","updated_at"],
  conversation_messages: ["id","conversation_id","company_id","direction","author","body","status","intent","model","edited","evidence_used","created_at"],
  suppressions: ["id","kind","value","reason","created_at"],
  seen_places: ["google_place_id","company_id","times_seen","first_seen_at","last_seen_at"],
  discovery_searches: ["id","query_key","segment","city","neighborhood","pages","runs","last_found","last_imported","last_run_at"],
  settings: ["key","value","updated_at"],
  jobs: ["id","type","status","progress","error","result","created_at","started_at","finished_at"],
  api_usage: ["id","provider","operation","requests","tokens","estimated_cost","created_at"],
};

/** Ordem pai -> filho (inserção). A remoção usa a ordem inversa. */
export const TABLE_ORDER = [
  "lists",
  "companies",
  "company_sources",
  "company_channels",
  "company_approaches",
  "seen_places",
  "website_snapshots",
  "signals",
  "company_scores",
  "ai_analyses",
  "conversations",
  "conversation_messages",
  "suppressions",
  "prospects",
  "tasks",
  "activities",
  "deals",
  "meetings",
  "proposals",
  "playbook_scripts",
  "services",
  "settings",
  "jobs",
  "api_usage",
  "discovery_searches",
] as const;

/** Tabelas cuja chave primária não é `id`. */
export const PRIMARY_KEY: Record<string, string> = {
  settings: "key",
  seen_places: "google_place_id",
};

export const pkOf = (table: string): string => PRIMARY_KEY[table] ?? "id";

export const SECRET_SETTING_KEYS = ["google_api_key", "openai_api_key", "anthropic_api_key"];
