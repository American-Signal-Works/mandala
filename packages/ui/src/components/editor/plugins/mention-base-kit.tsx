import { BaseMentionPlugin } from "@platejs/mention"

import { MentionElementStatic } from "@workspace/ui/components/mention-node-static"

export const BaseMentionKit = [
  BaseMentionPlugin.withComponent(MentionElementStatic),
]
