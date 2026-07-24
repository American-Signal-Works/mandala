// apps/web/components/editor/blocks/RowBlockElement.tsx
"use client"
import { useState } from "react"
import { PlateElement } from "platejs/react"
import {
  Card,
  CardHeader,
  CardDescription,
  CardContent,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Button } from "@workspace/ui/components/button"
import { Settings as SettingsIcon } from "lucide-react"
import { useRowDetail } from "../data-hooks/useRowDetail"
import { renderCell } from "@/components/collection/cells"
import { RowBlockSettings } from "../settings/RowBlockSettings"

export type RowBlockProps = { collectionId: string; rowId: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function RowBlockElement(props: any) {
  const element = props.element as { id?: string; rowProps?: RowBlockProps }
  const cfg: RowBlockProps = element.rowProps ?? { collectionId: "", rowId: "" }
  const [open, setOpen] = useState(false)
  const { row, fields, loading } = useRowDetail(cfg.collectionId, cfg.rowId)

  return (
    <PlateElement {...props}>
      <Card className="relative my-2" contentEditable={false}>
        <CardHeader>
          <CardDescription>Row</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : !row ? (
            <span className="text-muted-foreground italic">
              {cfg.collectionId ? "row not found" : "Pick a row in settings"}
            </span>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
              {fields.map((f) => (
                <div key={f.id} className="contents">
                  <dt className="text-sm text-muted-foreground">{f.name}</dt>
                  <dd>{renderCell(f, row.data[f.id] ?? null, () => {})}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2"
          onClick={(e) => {
            e.preventDefault()
            setOpen(true)
          }}
        >
          <SettingsIcon />
        </Button>
        <RowBlockSettings
          open={open}
          onOpenChange={setOpen}
          props={cfg}
          onSave={(next) => {
            props.editor.tf.setNodes({ rowProps: next }, { at: props.path })
            setOpen(false)
          }}
        />
      </Card>
      {props.children}
    </PlateElement>
  )
}
