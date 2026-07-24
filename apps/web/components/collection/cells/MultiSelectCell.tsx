"use client"
import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Checkbox } from "@workspace/ui/components/checkbox"
import type { SelectOption } from "@/lib/collections/types"

export function MultiSelectCell({
  value,
  options,
  onSave,
}: {
  value: string[]
  options: SelectOption[]
  onSave: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  function toggle(v: string) {
    const next = value.includes(v)
      ? value.filter((x) => x !== v)
      : [...value, v]
    onSave(next)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="min-h-[1.5rem] w-full text-left">
        {value.length === 0 ? (
          <span className="text-muted-foreground italic">empty</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {value.map((v) => {
              const opt = options.find((o) => o.value === v)
              return (
                <Badge key={v} variant="secondary">
                  {opt?.label ?? v}
                </Badge>
              )
            })}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.value} className="flex items-center gap-2">
              <Checkbox
                id={`opt-${o.value}`}
                checked={value.includes(o.value)}
                onCheckedChange={() => toggle(o.value)}
              />
              <label htmlFor={`opt-${o.value}`} className="text-sm">
                {o.label}
              </label>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
