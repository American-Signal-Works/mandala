// apps/web/components/editor/blocks/TableBlockElement.tsx
"use client"
import { useState, useEffect } from "react"
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
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@workspace/ui/components/table"
import { TableBlockSettings } from "../settings/TableBlockSettings"
import { renderCell } from "@/components/collection/cells"
import type { Field, Row } from "@/lib/collections/types"

export type TableBlockProps = {
  collectionId: string
  visibleFields: string[]
  pageSize: number
  title?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TableBlockElement(props: any) {
  const element = props.element as { id?: string; tableProps?: TableBlockProps }
  const cfg: TableBlockProps = element.tableProps ?? {
    collectionId: "",
    visibleFields: [],
    pageSize: 10,
  }
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [fields, setFields] = useState<Field[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!cfg.collectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear the initial loading state when there is no collection to fetch.
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(
        `/api/collections/${cfg.collectionId}/rows?limit=${cfg.pageSize}`
      ).then((r) => r.json()),
      fetch(`/api/collections/${cfg.collectionId}/fields`).then((r) =>
        r.json()
      ),
    ])
      .then(([r, f]: [Row[], Field[]]) => {
        if (cancelled) return
        setRows(Array.isArray(r) ? r : [])
        setFields(Array.isArray(f) ? f : [])
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cfg.collectionId, cfg.pageSize])

  const visible =
    cfg.visibleFields.length > 0
      ? fields.filter((f) => cfg.visibleFields.includes(f.id))
      : fields

  return (
    <PlateElement {...props}>
      <Card className="relative my-2" contentEditable={false}>
        <CardHeader>
          <CardDescription>{cfg.title ?? "Table"}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : !cfg.collectionId ? (
            <span className="text-muted-foreground italic">
              Pick a collection in settings
            </span>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {visible.map((f) => (
                    <TableHead key={f.id}>{f.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {visible.map((f) => (
                      <TableCell key={f.id}>
                        {renderCell(f, r.data[f.id] ?? null, () => {})}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
        <TableBlockSettings
          open={open}
          onOpenChange={setOpen}
          props={cfg}
          onSave={(next) => {
            props.editor.tf.setNodes({ tableProps: next }, { at: props.path })
            setOpen(false)
          }}
        />
      </Card>
      {props.children}
    </PlateElement>
  )
}
