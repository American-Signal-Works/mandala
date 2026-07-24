// apps/web/components/editor/settings/CardBlockSettings.tsx
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
import type { CardBlockProps } from "../blocks/CardBlockElement"

type CollectionLite = {
  id: string
  name: string
  fields: Array<{ id: string; name: string; type: string }>
}

export function CardBlockSettings({
  open,
  onOpenChange,
  props,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  props: CardBlockProps
  onSave: (next: CardBlockProps) => void
}) {
  const [collections, setCollections] = useState<CollectionLite[]>([])
  const [draft, setDraft] = useState<CardBlockProps>(props)

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

  const collection = collections.find((c) => c.id === draft.collectionId)
  const numericFields =
    collection?.fields.filter((f) => ["number", "currency"].includes(f.type)) ??
    []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Card settings</SheetTitle>
        </SheetHeader>
        <div className="py-4">
          <FieldGroup>
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
              <FieldLabel>Metric</FieldLabel>
              <Select
                value={draft.metric.kind}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    metric:
                      v === "count"
                        ? { kind: "count" }
                        : {
                            kind: v as "sum" | "avg" | "min" | "max",
                            fieldId: numericFields[0]?.id ?? "",
                          },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">Count of rows</SelectItem>
                  <SelectItem value="sum">Sum</SelectItem>
                  <SelectItem value="avg">Average</SelectItem>
                  <SelectItem value="min">Minimum</SelectItem>
                  <SelectItem value="max">Maximum</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            {draft.metric.kind !== "count" && (
              <Field>
                <FieldLabel>Field</FieldLabel>
                <Select
                  value={
                    (draft.metric as { fieldId: string }).fieldId || "__none__"
                  }
                  onValueChange={(v) =>
                    setDraft({
                      ...draft,
                      metric: {
                        ...(draft.metric as {
                          kind: "sum" | "avg" | "min" | "max"
                          fieldId: string
                        }),
                        fieldId: v === "__none__" ? "" : v,
                      },
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a numeric field" />
                  </SelectTrigger>
                  <SelectContent>
                    {numericFields.length === 0 ? (
                      <SelectItem value="__none__" disabled>
                        No numeric fields
                      </SelectItem>
                    ) : (
                      numericFields.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field>
              <FieldLabel>Format</FieldLabel>
              <Select
                value={draft.format}
                onValueChange={(v) =>
                  setDraft({ ...draft, format: v as "number" | "currency" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="currency">Currency</SelectItem>
                </SelectContent>
              </Select>
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
