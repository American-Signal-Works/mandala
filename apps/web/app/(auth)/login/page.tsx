import { LoginAuthFlow } from "@/components/auth/LoginAuthFlow"

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const auth = Array.isArray(params?.auth) ? params.auth[0] : params?.auth

  return (
    <LoginAuthFlow initialStep={auth === "success" ? "success" : "email"} />
  )
}
