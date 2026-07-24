"use client"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Badge } from "@workspace/ui/components/badge"
import type { SelectOption } from "@/lib/collections/types"

export function SelectCell({
  value,
  options,
  onSave,
}: {
  value: string | null
  options: SelectOption[]
  onSave: (value: string | null) => void
}) {
  const opt = options.find((o) => o.value === value)
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onSave(v === "__clear__" ? null : v)}
    >
      <SelectTrigger className="h-7 border-none bg-transparent shadow-none">
        <SelectValue
          placeholder={
            <span className="text-muted-foreground italic">empty</span>
          }
        >
          {opt && <Badge variant="secondary">{opt.label}</Badge>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="__clear__">— clear —</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
