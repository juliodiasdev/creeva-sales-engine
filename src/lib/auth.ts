import type { Session } from "@supabase/supabase-js";

import { getSupabase } from "./supabase";

export async function signIn(
  email: string,
  password: string,
): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(
      error.message === "Invalid login credentials"
        ? "E-mail ou senha incorretos."
        : error.message,
    );
  }
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await getSupabase().auth.getSession();

  return data.session;
}

export function onAuthChange(
  callback: (session: Session | null) => void,
): () => void {
  const { data } = getSupabase().auth.onAuthStateChange(
    (_event, session) => callback(session),
  );

  return () => data.subscription.unsubscribe();
}
