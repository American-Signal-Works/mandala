"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Command, XCircle } from "lucide-react"

import { Card, CardContent } from "@workspace/ui/components/card"
import { Spinner } from "@workspace/ui/components/spinner"

type BootstrapState = "preparing" | "ready" | "unavailable"

export function CliAuthorizationBootstrap({
  children,
  hasBoundRequest = false,
}: {
  children?: ReactNode
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
        setState(hasBoundRequest ? "ready" : "unavailable")
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
    void prepare().catch(() => setState("unavailable"))
  }, [hasBoundRequest])

  if (state === "ready") return children

  const unavailable = state === "unavailable"
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 py-10 text-foreground sm:px-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Command aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="font-heading text-base font-medium">Mandala</p>
            <p className="text-sm text-muted-foreground">CLI authorization</p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            {unavailable ? (
              <XCircle
                aria-hidden="true"
                className="mb-4 size-10 text-destructive"
              />
            ) : (
              <Spinner aria-hidden="true" className="mb-4 size-8" />
            )}
            <h1 className="text-xl font-medium text-balance">
              {unavailable
                ? "Terminal request unavailable"
                : "Preparing browser sign-in"}
            </h1>
            <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
              {unavailable
                ? "This request is missing, expired, or invalid. Return to your terminal and run mandala auth login again."
                : "Mandala is securely connecting this browser to your terminal."}
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
