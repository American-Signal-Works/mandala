"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/browser"

const SUCCESS_REDIRECT = "/login?auth=success"
const FAILURE_REDIRECT = "/login?error=callback_failed"

export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    let isMounted = true

    async function completeSignIn() {
      const supabase = createClient()
      const url = new URL(window.location.href)
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
        return
      }

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "email",
        })
        if (error) {
          throw error
        }
        return
      }

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          throw error
        }
        return
      }

      const { data, error } = await supabase.auth.getSession()
      if (error) {
        throw error
      }
      if (!data.session) {
        throw new Error("Missing auth callback session.")
      }
    }

    completeSignIn()
      .then(() => {
        if (isMounted) {
          router.replace(SUCCESS_REDIRECT)
        }
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

  return (
    <main className="dark flex min-h-svh items-center justify-center bg-muted px-4 text-foreground">
      <div className="text-sm text-muted-foreground">Completing sign in...</div>
    </main>
  )
}
