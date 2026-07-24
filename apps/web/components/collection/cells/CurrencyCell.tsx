"use client"
import { useState } from "react"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "JPY", "CHF", "AUD"]

export function CurrencyCell({
  value,
  onSave,
}: {
  value: { amount: number; currency_code: string } | null
  onSave: (value: { amount: number; currency_code: string } | null) => void
}) {
  const [amount, setAmount] = useState(
    value === null ? "" : String(value.amount)
  )
  const [code, setCode] = useState(value?.currency_code ?? "USD")
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-h-[1.5rem] w-full text-right tabular-nums"
      >
        {value === null ? (
          <span className="text-muted-foreground italic">empty</span>
        ) : (
          new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: value.currency_code,
          }).format(value.amount)
        )}
      </button>
    )
  }

  return (
    <div className="flex gap-1">
      <Input
        type="number"
        step="0.01"
        autoFocus
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        onBlur={() => {
          setEditing(false)
          const n = amount === "" ? null : Number(amount)
          const next = n === null ? null : { amount: n, currency_code: code }
          if (JSON.stringify(next) !== JSON.stringify(value)) onSave(next)
        }}
      />
      <Select value={code} onValueChange={setCode}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CURRENCIES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
