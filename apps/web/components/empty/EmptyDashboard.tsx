import { Empty } from "@workspace/ui/components/empty"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function EmptyDashboard({ pageId: _ }: { pageId: string }) {
  return (
    <Empty>
      <h3 className="font-medium">Block editor coming in Plan 3</h3>
      <p className="text-sm text-muted-foreground">
        Once the editor is wired up, type <code>/</code> to insert blocks
        (cards, charts, tables, text).
      </p>
    </Empty>
  )
}
