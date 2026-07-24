import {
  BaseFootnoteDefinitionPlugin,
  BaseFootnoteReferencePlugin,
} from "@platejs/footnote"
import { MarkdownPlugin, remarkMdx, remarkMention } from "@platejs/markdown"
import { KEYS } from "platejs"
import remarkEmoji from "remark-emoji"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- remark-stringify types cause "cannot be named" errors across module boundaries
export const MarkdownKit: any[] = [
  BaseFootnoteReferencePlugin,
  BaseFootnoteDefinitionPlugin,
  MarkdownPlugin.configure({
    options: {
      plainMarks: [KEYS.suggestion, KEYS.comment],
      remarkPlugins: [
        remarkMath,
        remarkGfm,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- remark-emoji type doesn't match unified plugin signature
        remarkEmoji as any,
        remarkMdx,
        remarkMention,
      ],
    },
  }),
]
