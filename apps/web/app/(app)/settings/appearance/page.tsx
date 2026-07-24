import { createClient } from "@/lib/supabase/server"
import { AppearanceForm } from "@/components/settings/AppearanceForm"

type Mode = "light" | "dark" | "system"
type Accent = "default" | "blue" | "emerald" | "rose" | "amber" | "violet"

export default async function AppearancePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from("profiles")
    .select("theme_mode, theme_accent")
    .eq("user_id", user.id)
    .single()

  const initialMode = (profile?.theme_mode ?? "system") as Mode
  const initialAccent = (profile?.theme_accent ?? "default") as Accent

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Appearance</h1>
      <AppearanceForm initialMode={initialMode} initialAccent={initialAccent} />
    </div>
  )
}
