// apps/web/components/editor/data-hooks/useChartData.ts
"use client"
import { useEffect, useState } from "react"
import type { AggregateMetric } from "@/lib/collections/collection"

export function useChartData(opts: {
  collectionId: string
  metric: AggregateMetric
  groupBy: string[]
}) {
  const [data, setData] = useState<Array<{ key: string; value: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!opts.collectionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset stale chart data when the collection is cleared.
      setData([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch("/api/aggregate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collectionId: opts.collectionId,
        metric: opts.metric,
        groupBy: opts.groupBy,
      }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        if (Array.isArray(res?.groups)) {
          setData(
            res.groups.map(
              (g: { key: Record<string, string>; value: number }) => ({
                key: Object.values(g.key).join(" / "),
                value: g.value,
              })
            )
          )
        } else if (typeof res?.value === "number") {
          setData([{ key: "value", value: res.value }])
        } else {
          setData([])
        }
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.collectionId, JSON.stringify(opts.metric), opts.groupBy.join(",")])

  return { data, loading }
}
