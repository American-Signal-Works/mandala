"use client"
import { useRouter } from "next/navigation"
import {
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Trash2,
  Pencil,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { toast } from "sonner"
import { renameField, deleteField } from "@/actions/collections"
import type { Field } from "@/lib/collections/types"

export function FieldHeader({
  field,
  sortDir,
  onClickSort,
}: {
  field: Field
  sortDir: "asc" | "desc" | null
  onClickSort: () => void
}) {
  const router = useRouter()

  return (
    <div className="group flex items-center gap-1">
      <button
        className="flex items-center gap-1 text-left"
        onClick={onClickSort}
        type="button"
      >
        <span className="text-sm font-medium">{field.name}</span>
        {sortDir === "asc" && <ArrowUp className="size-3" />}
        {sortDir === "desc" && <ArrowDown className="size-3" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 opacity-0 group-hover:opacity-100"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            disabled={field.is_system}
            onClick={async () => {
              const name = window.prompt("Rename field", field.name)
              if (!name) return
              const result = await renameField({ fieldId: field.id, name })
              if (!result.ok) {
                toast.error(result.error.message)
                return
              }
              router.refresh()
            }}
          >
            <Pencil data-icon="inline-start" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={field.is_system}
            onClick={async () => {
              if (!window.confirm(`Delete "${field.name}" and all its data?`))
                return
              const result = await deleteField({ fieldId: field.id })
              if (!result.ok) {
                toast.error(result.error.message)
                return
              }
              router.refresh()
            }}
          >
            <Trash2 data-icon="inline-start" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
