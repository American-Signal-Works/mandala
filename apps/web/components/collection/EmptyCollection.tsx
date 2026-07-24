import { Empty } from "@workspace/ui/components/empty"
import { Button } from "@workspace/ui/components/button"
import { Plus } from "lucide-react"

export function EmptyCollection({ onAddRow }: { onAddRow: () => void }) {
  return (
    <Empty>
      <h3 className="font-medium">No rows yet</h3>
      <p className="text-sm text-muted-foreground">
        Add a row to get started, or import data from a connection (Plan 4).
      </p>
      <Button onClick={onAddRow} size="sm" className="mt-3">
        <Plus data-icon="inline-start" />
        Add row
      </Button>
    </Empty>
  )
}
