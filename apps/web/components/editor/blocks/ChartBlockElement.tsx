// apps/web/components/editor/blocks/ChartBlockElement.tsx
"use client"
import dynamic from "next/dynamic"
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
import { useChartData } from "../data-hooks/useChartData"
import { ChartBlockSettings } from "../settings/ChartBlockSettings"

const RechartsChart = dynamic(
  () => import("./RechartsChart").then((m) => m.RechartsChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-48 w-full" />,
  }
)

export type ChartBlockProps = {
  collectionId: string
  chartType: "line" | "bar" | "pie" | "area"
  metric:
    | { kind: "count" }
    | { kind: "sum" | "avg" | "min" | "max"; fieldId: string }
  groupByFieldId: string
  title?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ChartBlockElement(props: any) {
  const element = props.element as { id?: string; chartProps?: ChartBlockProps }
  const cfg: ChartBlockProps = element.chartProps ?? {
    collectionId: "",
    chartType: "bar",
    metric: { kind: "count" },
    groupByFieldId: "",
  }
  const [open, setOpen] = useState(false)
  const { data, loading } = useChartData({
    collectionId: cfg.collectionId,
    metric: cfg.metric,
    groupBy: cfg.groupByFieldId ? [cfg.groupByFieldId] : [],
  })

  return (
    <PlateElement {...props}>
      <Card className="relative my-2" contentEditable={false}>
        <CardHeader>
          <CardDescription>{cfg.title ?? "Chart"}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : data.length === 0 ? (
            <span className="text-muted-foreground italic">no data</span>
          ) : (
            <RechartsChart type={cfg.chartType} data={data} />
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
        <ChartBlockSettings
          open={open}
          onOpenChange={setOpen}
          props={cfg}
          onSave={(next) => {
            props.editor.tf.setNodes({ chartProps: next }, { at: props.path })
            setOpen(false)
          }}
        />
      </Card>
      {props.children}
    </PlateElement>
  )
}
