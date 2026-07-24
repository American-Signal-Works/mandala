// apps/web/components/editor/settings/TableBlockSettings.tsx
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
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { TableBlockProps } from "../blocks/TableBlockElement"

type CollectionLite = { id: string; name: string }

export function TableBlockSettings({
  open,
  onOpenChange,
  props,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  props: TableBlockProps
  onSave: (next: TableBlockProps) => void
}) {
  const [collections, setCollections] = useState<CollectionLite[]>([])
  const [draft, setDraft] = useState<TableBlockProps>(props)

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Table settings</SheetTitle>
        </SheetHeader>
        <div className="py-4">
          <FieldGroup>
            <Field>
              <FieldLabel>Title</FieldLabel>
              <Input
                value={draft.title ?? ""}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Table"
              />
            </Field>
            <Field>
              <FieldLabel>Collection</FieldLabel>
              <Select
                value={draft.collectionId || "__none__"}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    collectionId: v === "__none__" ? "" : v,
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
              <FieldLabel>Rows to show</FieldLabel>
              <FieldDescription>
                Maximum number of rows displayed in this table.
              </FieldDescription>
              <Input
                type="number"
                min={1}
                max={500}
                value={draft.pageSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    pageSize: Math.max(1, Number(e.target.value) || 10),
                  })
                }
              />
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter>
          <Button onClick={() => onSave(draft)} disabled={!draft.collectionId}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
