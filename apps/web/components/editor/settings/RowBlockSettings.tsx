// apps/web/components/editor/settings/RowBlockSettings.tsx
"use client"
import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@workspace/ui/components/sheet"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { RowBlockProps } from "../blocks/RowBlockElement"

type CollectionLite = { id: string; name: string }
type RowLite = { id: string; data: Record<string, unknown> }

export function RowBlockSettings({
  open,
  onOpenChange,
  props,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  props: RowBlockProps
  onSave: (next: RowBlockProps) => void
}) {
  const [collections, setCollections] = useState<CollectionLite[]>([])
  const [rows, setRows] = useState<RowLite[]>([])
  const [draft, setDraft] = useState<RowBlockProps>(props)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the editor draft when the selected block changes.
    setDraft(props)
  }, [props, open])

  useEffect(() => {
    if (!open) return
    fetch("/api/collections")
      .then((r) => r.json())
      .then((data) => setCollections(Array.isArray(data) ? data : []))
  }, [open])

  useEffect(() => {
    if (!draft.collectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear stale rows when the draft no longer selects a collection.
      setRows([])
      return
    }
    fetch(`/api/collections/${draft.collectionId}/rows?limit=50`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
  }, [draft.collectionId])

  function rowLabel(r: RowLite): string {
    // Use the first text-looking field value as a label
    const firstStringValue = Object.values(r.data).find(
      (v) => typeof v === "string" && v.trim().length > 0
    )
    return (firstStringValue as string | undefined) ?? r.id.slice(0, 8)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Row settings</SheetTitle>
        </SheetHeader>
        <div className="py-4">
          <FieldGroup>
            <Field>
              <FieldLabel>Collection</FieldLabel>
              <Select
                value={draft.collectionId || "__none__"}
                onValueChange={(v) =>
                  setDraft({
                    collectionId: v === "__none__" ? "" : v,
                    rowId: "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a collection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" disabled>
                    Pick a collection
                  </SelectItem>
                  {collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Row</FieldLabel>
              <Select
                value={draft.rowId || "__none__"}
                onValueChange={(v) =>
                  setDraft({ ...draft, rowId: v === "__none__" ? "" : v })
                }
                disabled={!draft.collectionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a row" />
                </SelectTrigger>
                <SelectContent>
                  {rows.length === 0 ? (
                    <SelectItem value="__none__" disabled>
                      No rows in collection
                    </SelectItem>
                  ) : (
                    rows.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {rowLabel(r)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter>
          <Button
            onClick={() => onSave(draft)}
            disabled={!draft.collectionId || !draft.rowId}
          >
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
