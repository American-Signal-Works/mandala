"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"

type BootstrapState = "preparing" | "ready" | "failed"

export function CliAuthorizationBootstrap({
  children,
  failureFallback,
  hasBoundRequest = false,
}: {
  children?: ReactNode
  failureFallback?: ReactNode
  hasBoundRequest?: boolean
}) {
  const started = useRef(false)
  const [state, setState] = useState<BootstrapState>("preparing")

  useEffect(() => {
    if (started.current) return
    started.current = true

    const rawFragment = window.location.hash
    const fragment = new URLSearchParams(rawFragment.slice(1))
    const browserToken = fragment.get("request") ?? ""
    if (rawFragment) {
      window.history.replaceState(null, "", "/cli/authorize")
    }

    const prepare = async () => {
      if (!browserToken && !rawFragment) {
        await Promise.resolve()
        setState("ready")
        return
      }
      if (!/^[A-Za-z0-9_-]{43}$/.test(browserToken)) {
        throw new Error("request_invalid")
      }
      const response = await fetch(
        "/api/mandala/cli/device-authorizations/bootstrap",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browserToken }),
        }
      )
      if (!response.ok) throw new Error("bootstrap_failed")
      window.location.replace("/cli/authorize")
    }
    void prepare().catch(() => setState("failed"))
  }, [hasBoundRequest])

  if (state === "ready") return children
  if (state === "failed") return failureFallback ?? children
  return <LoginAuthFlow mode="sign-in" postAuthPath="/cli/authorize" />
}
