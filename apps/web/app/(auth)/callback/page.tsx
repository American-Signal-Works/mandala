import { AuthCallbackClient } from "./AuthCallbackClient"
import { getCallbackPendingAction } from "@/lib/auth/callback"

type AuthCallbackPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function AuthCallbackPage({
  searchParams,
}: AuthCallbackPageProps) {
  const params = await searchParams

  return (
    <AuthCallbackClient
      initialPendingAction={getCallbackPendingAction(params?.method)}
    />
  )
}
