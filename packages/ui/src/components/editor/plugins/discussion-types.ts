// Shared type for discussions — kept in a separate file to avoid the circular
// import that arises when discussion-kit.tsx (which imports BlockDiscussion)
// and block-discussion.tsx (which needs TDiscussion) depend on each other.

import type { TComment } from "@workspace/ui/components/comment"

export type TDiscussion = {
  id: string
  comments: TComment[]
  createdAt: Date
  isResolved: boolean
  userId: string
  documentContent?: string
}
