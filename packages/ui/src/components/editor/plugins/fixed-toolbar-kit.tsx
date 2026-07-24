"use client"

import { createPlatePlugin } from "platejs/react"

import { FixedToolbar } from "@workspace/ui/components/fixed-toolbar"
import { FixedToolbarButtons } from "@workspace/ui/components/fixed-toolbar-buttons"

export const FixedToolbarKit = [
  createPlatePlugin({
    key: "fixed-toolbar",
    render: {
      beforeEditable: () => (
        <FixedToolbar>
          <FixedToolbarButtons />
        </FixedToolbar>
      ),
    },
  }),
]
