import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const STORAGE_KEY = "creava-supabase-config";

/**
 * A URL e a chave "anon" do Supabase são públicas por design
 * (a proteção dos dados é o login + RLS). Podem vir embutidas no
 * build (VITE_*) ou ser informadas na primeira execução.
 */
export function loadConfig(): SupabaseConfig | null {
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as
    | string
    | undefined;

  if (url && anonKey) return { url, anonKey };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SupabaseConfig>;

      if (parsed.url && parsed.anonKey) {
        return { url: parsed.url, anonKey: parsed.anonKey };
      }
    }
  } catch {
    // armazenamento indisponível
  }

  return null;
}

export function saveConfig(config: SupabaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  client = null;
}

export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignora
  }

  client = null;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const config = loadConfig();

    if (!config) {
      throw new Error("Supabase não configurado.");
    }

    client = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return client;
}
