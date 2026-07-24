// apps/web/components/collection/CollectionHeader.tsx
"use client"
import { PageHeader } from "@/components/pages/PageHeader"

export function CollectionHeader({
  pageId,
  title,
  emoji,
  importSlot,
}: {
  pageId: string
  title: string
  emoji: string | null
  importSlot?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 border-b pb-4">
      <PageHeader pageId={pageId} initialTitle={title} emoji={emoji} />
      {importSlot && (
        <div className="flex items-center gap-2">{importSlot}</div>
      )}
    </div>
  )
}
