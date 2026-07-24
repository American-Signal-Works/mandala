// apps/web/components/editor/plugins/row-plugin.tsx
"use client"
import { createPlatePlugin } from "platejs/react"
import { RowBlockElement } from "../blocks/RowBlockElement"

export const DataRowPlugin = createPlatePlugin({
  key: "data-row",
  node: { isElement: true, isVoid: true, type: "data-row" },
  render: { node: RowBlockElement },
})
