import { BaseCalloutPlugin } from "@platejs/callout"

import { CalloutElementStatic } from "@workspace/ui/components/callout-node-static"

export const BaseCalloutKit = [
  BaseCalloutPlugin.withComponent(CalloutElementStatic),
]
