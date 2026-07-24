"use client"
import { Input } from "@workspace/ui/components/input"
import { useState } from "react"

export function DateTimeCell({
  value,
  onSave,
}: {
  value: string | null
  onSave: (value: string | null) => void
}) {
  const [v, setV] = useState(value ? value.slice(0, 16) : "")
  return (
    <Input
      type="datetime-local"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (!v) {
          if (value !== null) onSave(null)
          return
        }
        const iso = new Date(v).toISOString()
        if (iso !== value) onSave(iso)
      }}
    />
  )
}
