// Supabase Auth client — wraps @supabase/supabase-js with the same
// signIn/signOut API shape the app previously used with Better Auth.

import { supabase } from "./supabaseClient";

export const signIn = {
  email: async ({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<{ error?: { message: string } | null }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: { message: error.message } };
    return { error: null };
  },
};

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
