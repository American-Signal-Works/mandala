import { connections } from "@/lib/connections"
import { createClient } from "@/lib/supabase/server"
import { ConnectionCard } from "@/components/connections/ConnectionCard"

export default async function ConnectionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: history } = await supabase
    .from("connection_imports")
    .select(
      "connection, filename, imported_at, rows_added, status, error_message"
    )
    .eq("owner_type", "user")
    .eq("owner_id", user!.id)
    .order("imported_at", { ascending: false })

  const byConn = (id: string) =>
    (history ?? []).filter((h) => h.connection === id)

  return (
    <div className="space-y-4">
      <h1 className="mb-2 text-2xl font-semibold">Connections</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Sources that produce collections in your workspace.
      </p>
      {connections.map((c) => (
        <ConnectionCard
          key={c.id}
          connectionId={c.id}
          displayName={c.displayName}
          description={c.description}
          history={
            byConn(c.id) as Array<{
              filename: string | null
              imported_at: string
              rows_added: number
              status: string
              error_message: string | null
            }>
          }
          isConnected={byConn(c.id).some((h) => h.status === "parsed")}
        />
      ))}
      <p className="mt-8 text-sm text-muted-foreground">
        More connectors coming soon — Schwab, Fidelity, Plaid, generic CSV.
      </p>
    </div>
  )
}
