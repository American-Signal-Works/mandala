"use server";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

/**
 * Derive the public origin of the current request from headers.
 *
 * Vercel and most reverse proxies set x-forwarded-host + x-forwarded-proto.
 * Local dev falls back to the raw Host header. Avoids depending on
 * NEXT_PUBLIC_SITE_URL being configured per environment.
 */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto = h.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

const SignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signUp(formData: FormData) {
  const parsed = SignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false as const, error: { code: "INVALID_INPUT", message: parsed.error.issues[0]!.message } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${await getOrigin()}/callback` },
  });

  if (error) {
    return { ok: false as const, error: { code: "SIGN_UP_FAILED", message: error.message } };
  }

  redirect("/");
}

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signIn(formData: FormData) {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false as const, error: { code: "INVALID_INPUT", message: parsed.error.issues[0]!.message } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false as const, error: { code: "SIGN_IN_FAILED", message: error.message } };
  }

  redirect("/");
}

const ResetSchema = z.object({ email: z.string().email() });

export async function requestPasswordReset(formData: FormData) {
  const parsed = ResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false as const, error: { code: "INVALID_INPUT", message: parsed.error.issues[0]!.message } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await getOrigin()}/callback?next=/settings/account`,
  });
  if (error) {
    return { ok: false as const, error: { code: "RESET_FAILED", message: error.message } };
  }

  return { ok: true as const, data: { sent: true } };
}

const MagicLinkSchema = z.object({ email: z.string().email() });

export async function signInWithMagicLink(formData: FormData) {
  const parsed = MagicLinkSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false as const, error: { code: "INVALID_INPUT", message: parsed.error.issues[0]!.message } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      // Auto-create the user on first magic link — no separate sign-up step required.
      shouldCreateUser: true,
      emailRedirectTo: `${await getOrigin()}/callback`,
    },
  });

  if (error) {
    return { ok: false as const, error: { code: "MAGIC_LINK_FAILED", message: error.message } };
  }

  return { ok: true as const, data: { sent: true, email: parsed.data.email } };
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${await getOrigin()}/callback`,
    },
  });
  if (error || !data.url) {
    return { ok: false as const, error: { code: "OAUTH_FAILED", message: error?.message ?? "Failed to initiate Google sign-in" } };
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
