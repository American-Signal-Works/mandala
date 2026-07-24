"use client"
import { useState } from "react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Trash2 } from "lucide-react"
import type { Field, Filter, FilterOperator } from "@/lib/collections/types"

const OPS_FOR_TYPE: Record<string, FilterOperator[]> = {
  text: ["eq", "neq", "contains", "starts_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  currency: ["gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  date: ["eq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  datetime: ["eq", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
  select: ["eq", "neq", "is_empty", "is_not_empty"],
  multi_select: ["in", "not_in", "is_empty", "is_not_empty"],
  checkbox: ["eq"],
}

export function FilterPopover({
  fields,
  value,
  onChange,
  children,
}: {
  fields: Field[]
  value: Filter[]
  onChange: (next: Filter[]) => void
  children: React.ReactNode
}) {
  const [draft, setDraft] = useState<Filter[]>(value)

  function setField(idx: number, fieldId: string) {
    const next = [...draft]
    next[idx] = {
      ...next[idx]!,
      fieldId,
      operator:
        OPS_FOR_TYPE[fields.find((f) => f.id === fieldId)?.type ?? "text"]![0]!,
    }
    setDraft(next)
  }
  function setOp(idx: number, op: FilterOperator) {
    const next = [...draft]
    next[idx] = { ...next[idx]!, operator: op }
    setDraft(next)
  }
  function setVal(idx: number, v: string) {
    const next = [...draft]
    next[idx] = { ...next[idx]!, value: v }
    setDraft(next)
  }
  function add() {
    setDraft([
      ...draft,
      { fieldId: fields[0]?.id ?? "", operator: "eq", value: "" },
    ])
  }
  function remove(idx: number) {
    setDraft(draft.filter((_, i) => i !== idx))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[28rem]">
        <div className="space-y-2">
          {draft.map((f, idx) => {
            const field = fields.find((x) => x.id === f.fieldId)
            const ops = OPS_FOR_TYPE[field?.type ?? "text"] ?? []
            const needsValue = !["is_empty", "is_not_empty"].includes(
              f.operator
            )
            return (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={f.fieldId}
                  onValueChange={(v) => setField(idx, v)}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={f.operator}
                  onValueChange={(v) => setOp(idx, v as FilterOperator)}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ops.map((o) => (
                      <SelectItem key={o} value={o}>
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsValue && (
                  <Input
                    value={(f.value as string) ?? ""}
                    onChange={(e) => setVal(idx, e.target.value)}
                  />
                )}
                <Button variant="ghost" size="icon" onClick={() => remove(idx)}>
                  <Trash2 />
                </Button>
              </div>
            )
          })}
          <div className="flex justify-between">
            <Button size="sm" variant="ghost" onClick={add}>
              + Add filter
            </Button>
            <Button size="sm" onClick={() => onChange(draft)}>
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
