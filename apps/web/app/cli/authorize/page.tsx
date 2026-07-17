import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import { cliDeviceAuthorizationInspectionSchema } from "@workspace/control-plane"

import { inspectCliDeviceAuthorization } from "@/actions/admin/cli-auth"
import { CliAuthorizeFlow } from "@/components/auth/CliAuthorizeFlow"
import { CliAuthorizationBootstrap } from "@/components/auth/CliAuthorizationBootstrap"
import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"
import {
  authorizationSubjectHash,
  CLI_AUTHORIZATION_COOKIE,
  hashAuthorizationSecret,
  isBrowserAuthorizationToken,
} from "@/lib/mandala/cli-auth"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function CliAuthorizePage() {
  const cookieStore = await cookies()
  const browserToken = cookieStore.get(CLI_AUTHORIZATION_COOKIE)?.value ?? ""
  const requestIsPresent = isBrowserAuthorizationToken(browserToken)

  if (!requestIsPresent) {
    return <CliAuthorizationBootstrap />
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return (
      <CliAuthorizationBootstrap hasBoundRequest>
        <LoginAuthFlow mode="sign-in" postAuthPath="/cli/authorize" />
      </CliAuthorizationBootstrap>
    )
  }

  const requestHeaders = await headers()
  const inspectionResult = await inspectCliDeviceAuthorization({
    p_actor_user_id: user.id,
    p_browser_token_hash: hashAuthorizationSecret(browserToken),
    p_subject_hash: authorizationSubjectHash(requestHeaders),
  })
  const parsedInspection = cliDeviceAuthorizationInspectionSchema.safeParse(
    inspectionResult.data
  )
  const inspection =
    !inspectionResult.error &&
    parsedInspection.success &&
    parsedInspection.data.status === "pending"
      ? parsedInspection.data
      : null

  return (
    <CliAuthorizationBootstrap hasBoundRequest>
      <CliAuthorizeFlow requestAvailable={Boolean(inspection)} />
    </CliAuthorizationBootstrap>
  )
}
