"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"
import type { AuthCallbackPendingAction } from "@/lib/auth/callback"
import { getSafePostAuthPath } from "@/lib/auth/redirect"
import { createClient } from "@/lib/supabase/browser"

const FAILURE_REDIRECT = "/login?error=callback_failed"

export function AuthCallbackClient({
  initialPendingAction,
}: {
  initialPendingAction: AuthCallbackPendingAction
}) {
  const router = useRouter()

  useEffect(() => {
    let isMounted = true
    const url = new URL(window.location.href)
    const successRedirect = getSafePostAuthPath(url.searchParams.get("next"))

    async function completeSignIn() {
      const supabase = createClient()
      const hashParams = new URLSearchParams(
        window.location.hash.replace(/^#/, "")
      )

      const callbackError =
        url.searchParams.get("error_description") ||
        hashParams.get("error_description")

      if (callbackError) {
        throw new Error(callbackError)
      }

      const code = url.searchParams.get("code")
      const tokenHash = url.searchParams.get("token_hash")
      const accessToken = hashParams.get("access_token")
      const refreshToken = hashParams.get("refresh_token")

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          throw error
        }
      } else if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "email",
        })
        if (error) {
          throw error
        }
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          throw error
        }
      } else {
        const { data, error } = await supabase.auth.getSession()
        if (error) {
          throw error
        }
        if (!data.session) {
          throw new Error("Missing auth callback session.")
        }
      }

      const { data, error } = await supabase.auth.getUser()
      if (error) {
        throw error
      }
      if (!data.user) {
        throw new Error("Missing authenticated callback user.")
      }
    }

    completeSignIn()
      .then(() => {
        if (isMounted) router.replace(successRedirect)
      })
      .catch(() => {
        if (isMounted) {
          router.replace(FAILURE_REDIRECT)
        }
      })

    return () => {
      isMounted = false
    }
  }, [router])

  return <LoginAuthFlow initialPendingAction={initialPendingAction} />
}
