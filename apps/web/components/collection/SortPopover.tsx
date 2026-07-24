"use client"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import type { Field, Sort } from "@/lib/collections/types"

export function SortPopover({
  fields,
  value,
  onChange,
  children,
}: {
  fields: Field[]
  value: Sort[]
  onChange: (next: Sort[]) => void
  children: React.ReactNode
}) {
  const current = value[0] ?? null

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="space-y-3">
          <Select
            value={current?.fieldId ?? ""}
            onValueChange={(fid) =>
              onChange(
                fid
                  ? [{ fieldId: fid, direction: current?.direction ?? "asc" }]
                  : []
              )
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a field" />
            </SelectTrigger>
            <SelectContent>
              {fields.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {current && (
            <ToggleGroup
              type="single"
              value={current.direction}
              onValueChange={(d) =>
                d && onChange([{ ...current, direction: d as "asc" | "desc" }])
              }
            >
              <ToggleGroupItem value="asc">Ascending</ToggleGroupItem>
              <ToggleGroupItem value="desc">Descending</ToggleGroupItem>
            </ToggleGroup>
          )}
          {current && (
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              Clear sort
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
