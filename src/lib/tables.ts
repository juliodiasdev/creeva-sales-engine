/**
 * Tabelas e colunas aceitas em backup/restauração. Deve refletir
 * supabase/schema.sql (há um teste que garante isso).
 */
export const TABLE_COLUMNS: Record<string, string[]> = {
  companies: ["id","name","segment","city","state","website","phone","instagram","google_place_id","cnpj","legal_name","cnae","company_size","registration_status","opened_at","capital","address","category","rating","reviews_count","domain","phone_normalized","dedupe_key","lead_status","disqualified_reason","created_at","updated_at"],
  company_sources: ["id","company_id","source_type","source_id","raw_data","created_at"],
  website_snapshots: ["id","company_id","url","facts","fetched_at"],
  signals: ["id","company_id","type","value","evidence","source","confidence","created_at"],
  company_scores: ["id","company_id","fit","need","capacity","intent","total","confidence","reasons","created_at"],
  ai_analyses: ["id","company_id","summary","main_problem","opportunity","recommended_offer","outreach_angle","confidence","model","created_at"],
  prospects: ["id","company_id","status","priority","score","next_action","next_action_at","qualification_notes","lost_reason","closed_at","created_at","updated_at"],
  tasks: ["id","prospect_id","type","title","description","priority","due_at","completed_at","outcome","created_at"],
  activities: ["id","prospect_id","type","channel","content","metadata","occurred_at"],
  deals: ["id","prospect_id","service_type","title","value","probability","status","expected_close_at","closed_at","recurring","lost_reason","created_at","updated_at"],
  meetings: ["id","prospect_id","scheduled_at","notes","need","budget","decision_maker","timeline","created_at"],
  proposals: ["id","deal_id","prospect_id","value","description","sent_at","valid_until","created_at"],
  playbook_scripts: ["id","segment","kind","title","body","created_at"],
  settings: ["key","value","updated_at"],
  jobs: ["id","type","status","progress","error","result","created_at","started_at","finished_at"],
  api_usage: ["id","provider","operation","requests","tokens","estimated_cost","created_at"],
};

/** Ordem pai -> filho (inserção). A remoção usa a ordem inversa. */
export const TABLE_ORDER = [
  "companies",
  "company_sources",
  "website_snapshots",
  "signals",
  "company_scores",
  "ai_analyses",
  "prospects",
  "tasks",
  "activities",
  "deals",
  "meetings",
  "proposals",
  "playbook_scripts",
  "settings",
  "jobs",
  "api_usage",
] as const;

export const SECRET_SETTING_KEYS = ["google_api_key", "openai_api_key"];
