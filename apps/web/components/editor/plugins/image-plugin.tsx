// apps/web/components/editor/plugins/image-plugin.tsx
"use client"
import { createPlatePlugin } from "platejs/react"
import { ImageBlockElement } from "../blocks/ImageBlockElement"

export const ImagePlugin = createPlatePlugin({
  key: "uploaded-image",
  node: { isElement: true, isVoid: true, type: "uploaded-image" },
  render: { node: ImageBlockElement },
})
