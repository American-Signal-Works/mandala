// apps/web/components/editor/plugins/table-plugin.tsx
"use client"
import { createPlatePlugin } from "platejs/react"
import { TableBlockElement } from "../blocks/TableBlockElement"

// Use "data-table" key to avoid colliding with Plate's built-in table block.
export const DataTablePlugin = createPlatePlugin({
  key: "data-table",
  node: { isElement: true, isVoid: true, type: "data-table" },
  render: { node: TableBlockElement },
})
