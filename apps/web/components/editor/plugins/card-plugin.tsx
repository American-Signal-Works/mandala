// apps/web/components/editor/plugins/card-plugin.tsx
"use client"
import { createPlatePlugin } from "platejs/react"
import { CardBlockElement } from "../blocks/CardBlockElement"

export const CardPlugin = createPlatePlugin({
  key: "card",
  node: { isElement: true, isVoid: true, type: "card" },
  render: { node: CardBlockElement },
})
