// apps/web/components/editor/data-hooks/useMetric.ts
"use client"
import { useEffect, useState } from "react"
import type { AggregateMetric } from "@/lib/collections/collection"

export function useMetric(collectionId: string, metric: AggregateMetric) {
  const [value, setValue] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!collectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- No request will run without a collection.
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch("/api/aggregate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collectionId, metric }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setValue(data.value ?? null)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, JSON.stringify(metric)])

  return { value, loading }
}
