"use client"
import { useState } from "react"
import { Calendar } from "@workspace/ui/components/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { format } from "date-fns"

export function DateCell({
  value,
  onSave,
}: {
  value: string | null
  onSave: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const date = value ? new Date(value) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="min-h-[1.5rem] w-full text-left">
        {date ? (
          format(date, "PP")
        ) : (
          <span className="text-muted-foreground italic">empty</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            if (d) onSave(d.toISOString().slice(0, 10))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
