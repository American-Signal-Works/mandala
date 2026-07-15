import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"
import {
  getAuthCallbackFailureMessage,
  isAuthCallbackFailure,
} from "@/lib/auth/callback"
import { INVITATION_COMPLETE_PATH } from "@/lib/auth/redirect"

type SignUpPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const params = await searchParams
  const error = Array.isArray(params?.error) ? params.error[0] : params?.error
  const invitation = Array.isArray(params?.invitation)
    ? params.invitation[0]
    : params?.invitation
  const invitationMessage = getInvitationMessage(invitation)

  return (
    <LoginAuthFlow
      initialFormMessage={
        invitationMessage ??
        (error === "callback_failed" || isAuthCallbackFailure(error)
          ? getAuthCallbackFailureMessage(error)
          : null)
      }
      postAuthPath={
        invitation === "pending" ? INVITATION_COMPLETE_PATH : undefined
      }
      mode="sign-up"
    />
  )
}

function getInvitationMessage(value: string | undefined) {
  if (value === "pending") {
    return "Continue with the email address that received this workspace invitation."
  }
  if (value === "expired") {
    return "This workspace invitation has expired. Ask the workspace Owner for a new one."
  }
  if (value === "missing" || value === "unavailable") {
    return "This workspace invitation is unavailable. Ask the workspace Owner for a new one."
  }
  return null
}
