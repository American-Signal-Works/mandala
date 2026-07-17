"use client"

import { useEffect, useRef, useState } from "react"
import { cliDeviceAuthorizationDecisionResponseSchema } from "@workspace/control-plane"

import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"

type CompletionState = "completing" | "complete" | "failed"

export function CliAuthorizeFlow({
  requestAvailable,
}: {
  requestAvailable: boolean
}) {
  const started = useRef(false)
  const [state, setState] = useState<CompletionState>(
    requestAvailable ? "completing" : "failed"
  )

  useEffect(() => {
    if (!requestAvailable || started.current) return
    started.current = true

    void fetch("/api/mandala/cli/device-authorizations/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        const parsed =
          cliDeviceAuthorizationDecisionResponseSchema.safeParse(body)
        if (
          !response.ok ||
          !parsed.success ||
          parsed.data.status !== "approved"
        ) {
          throw new Error("authorization_failed")
        }
        setState("complete")
      })
      .catch(() => setState("failed"))
  }, [requestAvailable])

  return (
    <LoginAuthFlow
      key={state}
      initialFormMessage={
        state === "failed"
          ? "We couldn't connect this sign-in to the terminal. Return to the terminal and try again."
          : null
      }
      initialStep={
        state === "complete"
          ? "success"
          : state === "failed"
            ? "email"
            : "verifying"
      }
      mode="sign-in"
      postAuthPath="/cli/authorize"
    />
  )
}
