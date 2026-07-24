"use client"
import { useState, useTransition } from "react"
import { renamePage } from "@/actions/pages"
import { toast } from "sonner"
import { PageEmojiPicker } from "./PageEmojiPicker"

export function PageHeader({
  pageId,
  initialTitle,
  emoji,
}: {
  pageId: string
  initialTitle: string
  emoji: string | null
}) {
  const [title, setTitle] = useState(initialTitle)
  const [editing, setEditing] = useState(false)
  const [, startTransition] = useTransition()

  function commit() {
    setEditing(false)
    if (title !== initialTitle) {
      startTransition(async () => {
        const result = await renamePage({ pageId, title })
        if (!result.ok) toast.error(result.error.message)
      })
    }
  }

  return (
    <div className="mb-6 flex items-center gap-2">
      <PageEmojiPicker pageId={pageId} current={emoji} />
      {editing ? (
        <input
          autoFocus
          className="border-b bg-transparent text-3xl font-semibold focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-3xl font-semibold"
        >
          {title}
        </button>
      )}
    </div>
  )
}
