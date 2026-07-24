"use client"
import { useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import { signOut } from "@/actions/auth"
import { createPage } from "@/actions/pages"
import { applyTemplate } from "@/actions/templates"
import { templates } from "@/lib/templates"

export type CommandGroup = "Navigation" | "Create" | "Settings" | "Account"
export type Command = {
  id: string
  group: CommandGroup
  label: string
  keywords?: string[]
  run: () => void | Promise<void>
}

export type PageRow = {
  id: string
  title: string
  page_type: "dashboard" | "collection"
}

export function useCommands(pages: PageRow[]): Command[] {
  const router = useRouter()
  const { setTheme } = useTheme()

  const commands: Command[] = [
    // Navigation: jump to any page
    ...pages.map(
      (p): Command => ({
        id: `goto-${p.id}`,
        group: "Navigation",
        label: `Go to ${p.title}`,
        keywords: [p.page_type],
        run: () =>
          router.push(
            p.page_type === "dashboard" ? `/p/${p.id}` : `/c/${p.id}`
          ),
      })
    ),
    {
      id: "goto-home",
      group: "Navigation",
      label: "Go to Home",
      run: () => router.push("/"),
    },

    // Create
    {
      id: "create-dashboard",
      group: "Create",
      label: "New blank dashboard",
      keywords: ["new", "dashboard"],
      run: async () => {
        const r = await createPage({ pageType: "dashboard", title: "Untitled" })
        if (r.ok) router.push(`/p/${r.data.id}`)
      },
    },
    {
      id: "create-collection",
      group: "Create",
      label: "New blank collection",
      keywords: ["new", "collection"],
      run: async () => {
        const r = await createPage({
          pageType: "collection",
          title: "Untitled",
        })
        if (r.ok) router.push(`/c/${r.data.id}`)
      },
    },
    ...templates.map(
      (t): Command => ({
        id: `template-${t.id}`,
        group: "Create",
        label: `Apply template: ${t.name}`,
        keywords: ["template", t.name.toLowerCase()],
        run: async () => {
          const r = await applyTemplate({ templateId: t.id })
          if (r.ok) router.push(`/p/${r.data.id}`)
        },
      })
    ),

    // Settings
    {
      id: "settings-account",
      group: "Settings",
      label: "Open Account settings",
      run: () => router.push("/settings/account"),
    },
    {
      id: "settings-profile",
      group: "Settings",
      label: "Open Profile settings",
      run: () => router.push("/settings/profile"),
    },
    {
      id: "settings-appearance",
      group: "Settings",
      label: "Open Appearance settings",
      run: () => router.push("/settings/appearance"),
    },
    {
      id: "settings-connections",
      group: "Settings",
      label: "Open Connections settings",
      run: () => router.push("/settings/connections"),
    },
    {
      id: "theme-light",
      group: "Settings",
      label: "Theme: Light",
      run: () => setTheme("light"),
    },
    {
      id: "theme-dark",
      group: "Settings",
      label: "Theme: Dark",
      run: () => setTheme("dark"),
    },
    {
      id: "theme-system",
      group: "Settings",
      label: "Theme: System",
      run: () => setTheme("system"),
    },

    // Account
    {
      id: "sign-out",
      group: "Account",
      label: "Sign out",
      run: async () => {
        try {
          await signOut()
        } catch {
          /* server action redirect() throws — expected */
        }
        router.push("/login")
        router.refresh()
      },
    },
  ]
  return commands
}
