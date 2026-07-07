import type { Metadata } from "next"
import { Geist_Mono, Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"

import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: { default: "Mandala", template: "%s · Mandala" },
  description:
    "A workspace for your data. Pages of blocks, collections, connections.",
}

type ThemeMode = "light" | "dark" | "system"

function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system"
}

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let accent: string = "default"
  let themeMode: ThemeMode = "system"
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("theme_accent, theme_mode")
      .eq("user_id", user.id)
      .maybeSingle()
    if (profile?.theme_accent) accent = profile.theme_accent
    if (isThemeMode(profile?.theme_mode)) themeMode = profile.theme_mode
  }

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-accent={accent}
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        inter.variable
      )}
    >
      <body>
        <ThemeProvider defaultTheme={themeMode}>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  )
}
