import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"

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
        error === "callback_failed"
          ? "We couldn't complete sign in. Try again."
          : null
      }
      initialStep={auth === "success" ? "verifying" : "email"}
      mode="sign-in"
    />
  )
}
