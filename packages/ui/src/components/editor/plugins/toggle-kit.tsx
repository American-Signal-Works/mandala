"use client"

import { TogglePlugin } from "@platejs/toggle/react"

import { IndentKit } from "@workspace/ui/components/editor/plugins/indent-kit"
import { ToggleElement } from "@workspace/ui/components/toggle-node"

export const ToggleKit = [
  ...IndentKit,
  TogglePlugin.withComponent(ToggleElement),
]
