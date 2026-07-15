import { createClient } from "@/lib/supabase/server"
import { ProfileForm } from "@/components/settings/ProfileForm"
import { getMyProfileIdentity } from "@/lib/profile/service"

export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const profile = await getMyProfileIdentity(supabase)

  let avatarUrl: string | null = null
  if (profile.avatarPath) {
    const { data: signed } = await supabase.storage
      .from("avatars")
      .createSignedUrl(profile.avatarPath, 60 * 60)
    avatarUrl = signed?.signedUrl ?? null
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Profile</h1>
      <ProfileForm
        initialName={profile.displayName ?? ""}
        initialTimezone={profile.timezone}
        avatarUrl={avatarUrl}
        initialVersion={profile.version}
      />
    </div>
  )
}
