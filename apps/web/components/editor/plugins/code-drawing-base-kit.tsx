import { BaseCodeDrawingPlugin } from "@platejs/code-drawing"

import { CodeDrawingElement } from "@workspace/ui/components/code-drawing-node"

export const BaseCodeDrawingKit = [
  BaseCodeDrawingPlugin.configure({
    node: { component: CodeDrawingElement },
  }),
]
