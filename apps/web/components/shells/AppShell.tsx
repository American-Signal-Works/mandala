import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { AppSidebar } from "@/components/sidebar/AppSidebar"
import { CommandPalette } from "@/components/command-palette/CommandPalette"
import { listPages } from "@/actions/pages"
import type { PageRow } from "@/components/command-palette/useCommands"

export async function AppShell({ children }: { children: React.ReactNode }) {
  const pagesResult = await listPages()
  const pages: PageRow[] = pagesResult.ok
    ? pagesResult.data
        .filter(
          (p): p is typeof p & { page_type: "dashboard" | "collection" } =>
            p.page_type === "dashboard" || p.page_type === "collection"
        )
        .map((p) => ({ id: p.id, title: p.title, page_type: p.page_type }))
    : []

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <CommandPalette pages={pages} />
          <span className="ml-auto text-xs text-muted-foreground">
            Press ⌘K
          </span>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
