"use client"
import { useState, useEffect, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@workspace/ui/components/table"
import { Button } from "@workspace/ui/components/button"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { CollectionHeader } from "./CollectionHeader"
import { EmptyCollection } from "./EmptyCollection"
import { renderCell } from "./cells"
import { SortPopover } from "./SortPopover"
import { FilterPopover } from "./FilterPopover"
import { AddFieldButton } from "./AddFieldButton"
import { FieldHeader } from "./FieldHeader"
import { addRow, updateRowField } from "@/actions/collections"
import { updateView } from "@/actions/views"
import type { Field, Row, Sort, Filter } from "@/lib/collections/types"
import { ImportSheet } from "@/components/connections/ImportSheet"
import { Upload } from "lucide-react"

export function CollectionListView({
  page,
  collection,
  view,
  initialRows,
}: {
  page: { id: string; title: string; emoji: string | null }
  collection: {
    id: string
    name: string
    fields: Field[]
    managedByConnection: string | null
    isSystem: boolean
  }
  view: {
    id: string
    config: { sort?: unknown; filters?: unknown; visibleFields?: string[] }
  }
  initialRows: Row[]
}) {
  const [rows, setRows] = useState<Row[]>(initialRows)
  // Sync local state when parent re-renders with fresh server data (e.g., after router.refresh()).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize fresh server rows after router.refresh().
    setRows(initialRows)
  }, [initialRows])
  const [, startTransition] = useTransition()
  const router = useRouter()
  const visible = view?.config?.visibleFields?.length
    ? collection.fields.filter((f) => view.config.visibleFields!.includes(f.id))
    : collection.fields

  function handleAddRow() {
    startTransition(async () => {
      const result = await addRow({ collectionId: collection.id, data: {} })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="mx-auto max-w-6xl py-6">
      <CollectionHeader
        pageId={page.id}
        title={page.title}
        emoji={page.emoji}
      />

      <div className="mb-3 flex gap-2">
        <SortPopover
          fields={collection.fields}
          value={(view?.config?.sort as Sort[] | undefined) ?? []}
          onChange={(next) => {
            void updateView({ viewId: view.id, config: { sort: next } })
          }}
        >
          <Button variant="outline" size="sm">
            Sort
          </Button>
        </SortPopover>
        <FilterPopover
          fields={collection.fields}
          value={(view?.config?.filters as Filter[] | undefined) ?? []}
          onChange={(next) => {
            void updateView({ viewId: view.id, config: { filters: next } })
          }}
        >
          <Button variant="outline" size="sm">
            Filter
          </Button>
        </FilterPopover>
        {collection.managedByConnection && (
          <ImportSheet defaultConnectionId={collection.managedByConnection}>
            <Button variant="outline" size="sm">
              <Upload data-icon="inline-start" />
              Import
            </Button>
          </ImportSheet>
        )}
      </div>

      {rows.length === 0 && visible.length === 0 ? (
        <EmptyCollection onAddRow={handleAddRow} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {visible.map((f) => (
                <TableHead key={f.id}>
                  <FieldHeader
                    field={f}
                    sortDir={
                      (view?.config?.sort as Sort[] | undefined)?.find(
                        (s) => s.fieldId === f.id
                      )?.direction ?? null
                    }
                    onClickSort={() => {
                      const sortArr =
                        (view?.config?.sort as Sort[] | undefined) ?? []
                      const cur = sortArr.find((s) => s.fieldId === f.id)
                      const nextDir: "asc" | "desc" | null = !cur
                        ? "asc"
                        : cur.direction === "asc"
                          ? "desc"
                          : null
                      const next =
                        nextDir === null
                          ? []
                          : [{ fieldId: f.id, direction: nextDir }]
                      void updateView({
                        viewId: view.id,
                        config: { sort: next },
                      })
                    }}
                  />
                </TableHead>
              ))}
              <TableHead>
                <AddFieldButton collectionId={collection.id} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {visible.map((f) => (
                  <TableCell key={f.id}>
                    {renderCell(f, row.data[f.id] ?? null, async (v) => {
                      setRows((rs) =>
                        rs.map((r) =>
                          r.id === row.id
                            ? { ...r, data: { ...r.data, [f.id]: v } }
                            : r
                        )
                      )
                      const result = await updateRowField({
                        rowId: row.id,
                        fieldId: f.id,
                        value: v,
                      })
                      if (!result.ok) toast.error(result.error.message)
                      else router.refresh()
                    })}
                  </TableCell>
                ))}
                <TableCell />
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={visible.length + 1}>
                <Button variant="ghost" size="sm" onClick={handleAddRow}>
                  <Plus data-icon="inline-start" />
                  Add row
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  )
}
