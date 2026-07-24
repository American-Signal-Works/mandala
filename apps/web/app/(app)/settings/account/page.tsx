import { createClient } from "@/lib/supabase/server"
import { AccountForm } from "@/components/settings/AccountForm"

export default async function AccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Account</h1>
      <AccountForm email={user.email ?? ""} />
    </div>
  )
}
