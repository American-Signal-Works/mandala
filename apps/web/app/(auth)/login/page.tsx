import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"
import {
  getAuthCallbackFailureMessage,
  isAuthCallbackFailure,
} from "@/lib/auth/callback"

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const auth = Array.isArray(params?.auth) ? params.auth[0] : params?.auth
  const error = Array.isArray(params?.error) ? params.error[0] : params?.error

  return (
    <LoginAuthFlow
      initialFormMessage={
        error === "callback_failed" || isAuthCallbackFailure(error)
          ? getAuthCallbackFailureMessage(error)
          : null
      }
      initialStep={auth === "success" ? "verifying" : "email"}
      initialSessionReplacementRequired={
        error === "session_replacement_required"
      }
      mode="sign-in"
    />
  )
}
