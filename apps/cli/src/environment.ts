import { CliError } from "./errors.js"

const localApiUrl = "http://127.0.0.1:3000"
const localSupabaseUrl = "http://127.0.0.1:54321"
const localSupabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

export type RuntimeEnvironment = Record<string, string | undefined>

export type SupabaseEnvironment = {
  url: string
  anonKey: string
}

export function getApiUrl(environment: RuntimeEnvironment): string {
  const value = environment.MANDALA_API_URL ?? localApiUrl
  return normalizeHttpUrl(value, "MANDALA_API_URL")
}

export function getSupabaseEnvironment(
  environment: RuntimeEnvironment
): SupabaseEnvironment {
  const url =
    environment.MANDALA_SUPABASE_URL ??
    environment.NEXT_PUBLIC_SUPABASE_URL ??
    localSupabaseUrl
  const anonKey =
    environment.MANDALA_SUPABASE_ANON_KEY ??
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    localSupabaseAnonKey
  return { url: normalizeHttpUrl(url, "Supabase URL"), anonKey }
}

function normalizeHttpUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CliError(
      "invalid_configuration",
      `${label} must be a valid HTTP or HTTPS URL.`
    )
  }
  if (
    !new Set(["http:", "https:"]).has(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new CliError(
      "invalid_configuration",
      `${label} must be a credential-free HTTP or HTTPS URL.`
    )
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new CliError(
      "insecure_configuration",
      `${label} must use HTTPS unless it targets the local loopback interface.`
    )
  }
  return url.toString().replace(/\/$/, "")
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  )
}
