import {
  createClient as createSupabaseClient,
  type User,
} from "@supabase/supabase-js"
import { z } from "zod"
import {
  decryptCliActorSession,
  hashAuthorizationSecret,
  isCliAccessToken,
} from "@/lib/mandala/cli-auth"
import { createAdminClient } from "./admin"
import { createClient as createCookieClient } from "./server"
import type { Database } from "./types"

export type RequestAuthContext = {
  authMode: "bearer" | "cookie"
  supabase: ReturnType<typeof createSupabaseClient<Database>>
  user: User
  cliSession?: {
    managed: boolean
    sessionId: string | null
    selectedCompanyId: string | null
    scopes: string[]
  }
}

type AuthenticateRequestOptions = {
  allowManagedCli?: boolean
}

const bearerPattern = /^Bearer ([^\s]+)$/i
const opaqueCliSessionValidationSchema = z
  .object({
    allowed: z.literal(true),
    sessionId: z.string().uuid(),
    userId: z.string().uuid(),
    selectedCompanyId: z.string().uuid().nullable(),
    scopes: z.array(z.string().min(1).max(100)).min(1).max(25),
    actorSessionCiphertext: z.string().min(20).max(20_000),
  })
  .strict()

export async function authenticateRequest(
  request: Request,
  options: AuthenticateRequestOptions = {}
): Promise<RequestAuthContext | null> {
  const authorization = request.headers.get("authorization")

  if (authorization !== null) {
    const match = bearerPattern.exec(authorization)
    const accessToken = match?.[1]
    if (!accessToken || accessToken.length > 8_192) return null

    if (isCliAccessToken(accessToken)) {
      if (!options.allowManagedCli) return null
      const admin = createAdminClient()
      const validation = await admin.rpc("validate_cli_session_v1", {
        p_access_token_hash: hashAuthorizationSecret(accessToken),
      })
      const parsedValidation = opaqueCliSessionValidationSchema.safeParse(
        validation.data
      )
      if (validation.error || !parsedValidation.success) return null

      let actorSession
      try {
        actorSession = decryptCliActorSession(
          parsedValidation.data.actorSessionCiphertext
        )
      } catch {
        return null
      }
      if (
        actorSession.userId !== parsedValidation.data.userId ||
        actorSession.expiresAt <= Math.floor(Date.now() / 1_000)
      ) {
        return null
      }

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
            headers: {
              Authorization: `Bearer ${actorSession.accessToken}`,
            },
          },
        }
      )
      const userResult = await supabase.auth.getUser(actorSession.accessToken)
      const user = userResult.data.user
      if (
        userResult.error ||
        !user ||
        user.id !== parsedValidation.data.userId
      ) {
        return null
      }

      return {
        authMode: "bearer",
        supabase,
        user,
        cliSession: {
          managed: true,
          sessionId: parsedValidation.data.sessionId,
          selectedCompanyId: parsedValidation.data.selectedCompanyId,
          scopes: parsedValidation.data.scopes,
        },
      }
    }

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

    return {
      authMode: "bearer",
      supabase,
      user,
    }
  }

  if (isUnsafeMethod(request.method) && !hasSameOrigin(request)) return null

  const supabase = await createCookieClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null
  return { authMode: "cookie", supabase, user }
}

export function hasCliWorkspaceScope(
  auth: RequestAuthContext,
  companyId: string,
  scope: string
): boolean {
  return (
    auth.authMode === "bearer" &&
    auth.cliSession?.managed === true &&
    auth.cliSession.selectedCompanyId === companyId &&
    auth.cliSession.scopes.includes(scope)
  )
}

export function allowsCliWorkspace(
  auth: RequestAuthContext,
  companyId: string,
  scope = "workspace:control"
): boolean {
  return (
    auth.cliSession?.managed !== true ||
    hasCliWorkspaceScope(auth, companyId, scope)
  )
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
