import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { Button } from "@workspace/ui/components/button";
import { signOut } from "@/actions/auth";
import { listPages } from "@/actions/pages";
import { PagesList } from "./PagesList";
import { NewPageMenu } from "./NewPageMenu";

export async function AppSidebar() {
  const result = await listPages();
  const pages = result.ok ? result.data : [];

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="px-3 py-2 font-semibold text-sm">Mandala</Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NewPageMenu />
            <PagesList pages={pages as { id: string; title: string; emoji: string | null; page_type: "dashboard" | "collection" }[]} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/settings/account">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">
                <LogOut data-icon="inline-start" />
                Sign out
              </Button>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
