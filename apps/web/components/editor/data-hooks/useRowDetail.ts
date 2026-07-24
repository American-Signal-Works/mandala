// apps/web/components/editor/data-hooks/useRowDetail.ts
"use client"
import { useEffect, useState } from "react"
import type { Field, Row } from "@/lib/collections/types"

export function useRowDetail(collectionId: string, rowId: string) {
  const [row, setRow] = useState<Row | null>(null)
  const [fields, setFields] = useState<Field[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!collectionId || !rowId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- No request will run without a complete row identity.
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`/api/collections/${collectionId}/rows/${rowId}`).then((r) =>
        r.json()
      ),
      fetch(`/api/collections/${collectionId}/fields`).then((r) => r.json()),
    ])
      .then(([r, f]: [Row | null, Field[]]) => {
        if (cancelled) return
        setRow(r)
        setFields(Array.isArray(f) ? f : [])
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [collectionId, rowId])

  return { row, fields, loading }
}
