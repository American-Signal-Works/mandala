"use client"
import type { Field, FieldValue } from "@/lib/collections/types"
import { TextCell } from "./TextCell"
import { NumberCell } from "./NumberCell"
import { CurrencyCell } from "./CurrencyCell"
import { DateCell } from "./DateCell"
import { DateTimeCell } from "./DateTimeCell"
import { SelectCell } from "./SelectCell"
import { MultiSelectCell } from "./MultiSelectCell"
import { CheckboxCell } from "./CheckboxCell"

export function renderCell(
  field: Field,
  value: FieldValue,
  onSave: (v: FieldValue) => void
) {
  switch (field.type) {
    case "text":
      return (
        <TextCell
          value={value as string | null}
          onSave={onSave as (v: string) => void}
        />
      )
    case "number":
      return (
        <NumberCell
          value={value as number | null}
          onSave={onSave as (v: number | null) => void}
        />
      )
    case "currency":
      return (
        <CurrencyCell
          value={value as { amount: number; currency_code: string } | null}
          onSave={
            onSave as (
              v: { amount: number; currency_code: string } | null
            ) => void
          }
        />
      )
    case "date":
      return (
        <DateCell
          value={value as string | null}
          onSave={onSave as (v: string | null) => void}
        />
      )
    case "datetime":
      return (
        <DateTimeCell
          value={value as string | null}
          onSave={onSave as (v: string | null) => void}
        />
      )
    case "select":
      return (
        <SelectCell
          value={value as string | null}
          options={field.options}
          onSave={onSave as (v: string | null) => void}
        />
      )
    case "multi_select":
      return (
        <MultiSelectCell
          value={(value as string[]) ?? []}
          options={field.options}
          onSave={onSave as (v: string[]) => void}
        />
      )
    case "checkbox":
      return (
        <CheckboxCell
          value={Boolean(value)}
          onSave={onSave as (v: boolean) => void}
        />
      )
  }
}
