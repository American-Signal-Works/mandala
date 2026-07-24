"use client"
import { Checkbox } from "@workspace/ui/components/checkbox"

export function CheckboxCell({
  value,
  onSave,
}: {
  value: boolean
  onSave: (value: boolean) => void
}) {
  return (
    <Checkbox checked={value} onCheckedChange={(v) => onSave(Boolean(v))} />
  )
}
