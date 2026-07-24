"use client"

import { CodeDrawingPlugin } from "@platejs/code-drawing/react"

import { CodeDrawingElement } from "@workspace/ui/components/code-drawing-node"

export const CodeDrawingKit = [
  CodeDrawingPlugin.withComponent(CodeDrawingElement),
]
