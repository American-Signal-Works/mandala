import {
  createClient as createSupabaseClient,
  type User,
} from "@supabase/supabase-js"
import { createClient as createCookieClient } from "./server"
import type { Database } from "./types"

export type RequestAuthContext = {
  authMode: "bearer" | "cookie"
  supabase: ReturnType<typeof createSupabaseClient<Database>>
  user: User
}

const bearerPattern = /^Bearer ([^\s]+)$/i

export async function authenticateRequest(
  request: Request
): Promise<RequestAuthContext | null> {
  const authorization = request.headers.get("authorization")

  if (authorization !== null) {
    const match = bearerPattern.exec(authorization)
    const accessToken = match?.[1]
    if (!accessToken || accessToken.length > 8_192) return null

    const supabase = createSupabaseClient<Database>(
      requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
      requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
        global: {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      }
    )
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(accessToken)

    if (error || !user) return null
    return { authMode: "bearer", supabase, user }
  }

  if (isUnsafeMethod(request.method) && !hasSameOrigin(request)) return null

  const supabase = await createCookieClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null
  return { authMode: "cookie", supabase, user }
}

function isUnsafeMethod(method: string): boolean {
  return !new Set(["GET", "HEAD", "OPTIONS"]).has(method.toUpperCase())
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

function requiredEnvironment(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}
