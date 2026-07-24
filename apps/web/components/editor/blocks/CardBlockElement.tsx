// apps/web/components/editor/blocks/CardBlockElement.tsx
"use client"
import { useState } from "react"
import { PlateElement } from "platejs/react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Button } from "@workspace/ui/components/button"
import { Settings as SettingsIcon } from "lucide-react"
import { useMetric } from "../data-hooks/useMetric"
import { CardBlockSettings } from "../settings/CardBlockSettings"

export type CardBlockProps = {
  collectionId: string
  metric:
    | { kind: "count" }
    | { kind: "sum" | "avg" | "min" | "max"; fieldId: string }
  format: "number" | "currency"
}

const METRIC_LABELS: Record<string, string> = {
  count: "Count",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
}

function describeMetric(m: CardBlockProps["metric"]): string {
  if (m.kind === "count") return "Count of rows"
  return `${METRIC_LABELS[m.kind] ?? m.kind} of field`
}

function formatValue(v: number, fmt: CardBlockProps["format"]): string {
  if (fmt === "currency")
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
    }).format(v)
  return v.toLocaleString()
}

// PlateElement signature varies by version; type as `any` for compatibility.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function CardBlockElement(props: any) {
  // The element node carries our `props` object on its custom field.
  const element = props.element as { id?: string; cardProps?: CardBlockProps }
  const cfg: CardBlockProps = element.cardProps ?? {
    collectionId: "",
    metric: { kind: "count" },
    format: "number",
  }
  const [open, setOpen] = useState(false)
  const { value, loading } = useMetric(cfg.collectionId, cfg.metric)

  return (
    <PlateElement {...props}>
      <Card className="relative my-2" contentEditable={false}>
        <CardHeader>
          <CardDescription>{describeMetric(cfg.metric)}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-24" />
          ) : value === null ? (
            <span className="text-muted-foreground italic">no data</span>
          ) : (
            <span className="text-2xl font-semibold tabular-nums">
              {formatValue(value, cfg.format)}
            </span>
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
        <CardBlockSettings
          open={open}
          onOpenChange={setOpen}
          props={cfg}
          onSave={(next) => {
            props.editor.tf.setNodes({ cardProps: next }, { at: props.path })
            setOpen(false)
          }}
        />
      </Card>
      {props.children}
    </PlateElement>
  )
}
