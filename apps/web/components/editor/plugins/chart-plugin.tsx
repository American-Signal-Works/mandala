// apps/web/components/editor/plugins/chart-plugin.tsx
"use client"
import { createPlatePlugin } from "platejs/react"
import { ChartBlockElement } from "../blocks/ChartBlockElement"

export const ChartPlugin = createPlatePlugin({
  key: "chart",
  node: { isElement: true, isVoid: true, type: "chart" },
  render: { node: ChartBlockElement },
})
