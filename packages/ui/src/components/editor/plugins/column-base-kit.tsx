import { BaseColumnItemPlugin, BaseColumnPlugin } from "@platejs/layout"

import {
  ColumnElementStatic,
  ColumnGroupElementStatic,
} from "@workspace/ui/components/column-node-static"

export const BaseColumnKit = [
  BaseColumnPlugin.withComponent(ColumnGroupElementStatic),
  BaseColumnItemPlugin.withComponent(ColumnElementStatic),
]
