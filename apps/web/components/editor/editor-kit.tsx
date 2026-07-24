"use client"

import { type Value, TrailingBlockPlugin } from "platejs"
import { type TPlateEditor, useEditorRef } from "platejs/react"

import { AlignKit } from "./plugins/align-kit"
import { AutoformatKit } from "./plugins/autoformat-kit"
import { BasicBlocksKit } from "./plugins/basic-blocks-kit"
import { BasicMarksKit } from "./plugins/basic-marks-kit"
import { BlockMenuKit } from "./plugins/block-menu-kit"
import { BlockPlaceholderKit } from "./plugins/block-placeholder-kit"
import { CalloutKit } from "./plugins/callout-kit"
import { CodeBlockKit } from "./plugins/code-block-kit"
import { ColumnKit } from "./plugins/column-kit"
import { CommentKit } from "./plugins/comment-kit"
import { CursorOverlayKit } from "./plugins/cursor-overlay-kit"
import { DateKit } from "./plugins/date-kit"
import { DiscussionKit } from "./plugins/discussion-kit"
import { DndKit } from "./plugins/dnd-kit"
import { EmojiKit } from "./plugins/emoji-kit"
import { ExitBreakKit } from "./plugins/exit-break-kit"
import { FixedToolbarKit } from "./plugins/fixed-toolbar-kit"
import { FloatingToolbarKit } from "./plugins/floating-toolbar-kit"
import { FootnoteKit } from "./plugins/footnote-kit"
import { FontKit } from "./plugins/font-kit"
import { LineHeightKit } from "./plugins/line-height-kit"
import { LinkKit } from "./plugins/link-kit"
import { ListKit } from "./plugins/list-kit"
import { MarkdownKit } from "./plugins/markdown-kit"
import { MathKit } from "./plugins/math-kit"
import { MentionKit } from "./plugins/mention-kit"
import { SlashKit } from "./plugins/slash-kit"
import { SuggestionKit } from "./plugins/suggestion-kit"
import { TableKit } from "./plugins/table-kit"
import { TocKit } from "./plugins/toc-kit"
import { ToggleKit } from "./plugins/toggle-kit"
import { CardPlugin } from "./plugins/card-plugin"
import { ChartPlugin } from "./plugins/chart-plugin"
import { DataTablePlugin } from "./plugins/table-plugin"
import { DataRowPlugin } from "./plugins/row-plugin"
import { ImagePlugin } from "./plugins/image-plugin"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- remark-stringify types cause "cannot be named" errors across module boundaries
export const EditorKit: any[] = [
  ...BlockMenuKit,

  // Elements
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ToggleKit,
  ...TocKit,
  ...CalloutKit,
  ...ColumnKit,
  ...MathKit,
  ...DateKit,
  ...LinkKit,
  ...MentionKit,
  CardPlugin,
  ChartPlugin,
  DataTablePlugin,
  DataRowPlugin,
  ImagePlugin,

  // Marks
  ...BasicMarksKit,
  ...FontKit,

  // Block Style
  ...ListKit,
  ...AlignKit,
  ...LineHeightKit,

  // Collaboration
  ...DiscussionKit,
  ...CommentKit,
  ...SuggestionKit,

  // Editing
  ...SlashKit,
  ...AutoformatKit,
  ...CursorOverlayKit,
  ...DndKit,
  ...EmojiKit,
  ...ExitBreakKit,
  TrailingBlockPlugin,

  // Parsers
  ...MarkdownKit,
  ...FootnoteKit,

  // UI
  ...BlockPlaceholderKit,
  ...FixedToolbarKit,
  ...FloatingToolbarKit,
]

export type MyEditor = TPlateEditor<Value, (typeof EditorKit)[number]>

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutative types cause "cannot be named" errors across module boundaries
export const useEditor = (): any => useEditorRef<MyEditor>()
