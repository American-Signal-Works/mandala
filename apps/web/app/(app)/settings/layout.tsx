import Link from "next/link"

const tabs = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/appearance", label: "Appearance" },
  { href: "/settings/connections", label: "Connections" },
]

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[200px_1fr] gap-8 py-8">
      <nav className="flex flex-col gap-1">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded px-3 py-2 text-sm hover:bg-muted"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  )
}
