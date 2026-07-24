/* eslint-disable react-hooks/refs -- Save-loop and updatedAt tracking are imperative transport state; refs are accessed only in async callbacks and effects, never during render. */
"use client"
import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plate, PlateContent, usePlateEditor } from "platejs/react"
import { EditorKit } from "@/components/editor/editor-kit"
import { savePageDocument } from "@/actions/pages"
import { createSaveLoop } from "./save-loop"

type Props = {
  pageId: string
  initialDocument: unknown
  initialUpdatedAt: string
}

/** Extract the array of nodes Plate expects from the DB document shape.
 *
 * The DB stores `{ type: "doc", children: [...] }` but Plate's `Value`
 * is the raw array `[...]`. Accept both shapes so the component is robust
 * to whatever format arrives.
 */
function toPlateValue(doc: unknown): unknown[] {
  if (Array.isArray(doc)) return doc
  if (
    doc &&
    typeof doc === "object" &&
    "children" in doc &&
    Array.isArray((doc as { children: unknown }).children)
  ) {
    return (doc as { children: unknown[] }).children
  }
  // Fallback: empty paragraph
  return [{ type: "p", children: [{ text: "" }] }]
}

/** Wrap the Plate array back into the DB envelope before saving. */
function toDbDocument(value: unknown[]): unknown {
  return { type: "doc", children: value }
}

export function PlateEditor({
  pageId,
  initialDocument,
  initialUpdatedAt,
}: Props) {
  const router = useRouter()

  // Refs for values that change over time but must be readable from the async
  // save callback without recreating the loop on every render.
  const updatedAtRef = useRef(initialUpdatedAt)
  const pageIdRef = useRef(pageId)
  const routerRef = useRef(router)
  // Keep refs current on every render (no stale-closure risk in callbacks)
  updatedAtRef.current = initialUpdatedAt
  pageIdRef.current = pageId
  routerRef.current = router

  const editor = usePlateEditor({
    plugins: EditorKit,
    value: toPlateValue(initialDocument) as never[],
  })

  // Initialize the save-loop once per mount. We intentionally store it in a ref
  // and access it only in event handlers and effects — never during render.
  const loopRef = useRef<ReturnType<typeof createSaveLoop<unknown[]>> | null>(
    null
  )
  if (!loopRef.current) {
    loopRef.current = createSaveLoop<unknown[]>({
      save: async (doc) => {
        const result = await savePageDocument({
          pageId: pageIdRef.current,
          document: toDbDocument(doc),
          expectedUpdatedAt: updatedAtRef.current,
        })
        if (!result.ok) {
          if (result.error.code === "STALE_DOCUMENT") {
            toast.warning("Page changed elsewhere — refreshing.")
            routerRef.current.refresh()
          } else {
            toast.error(result.error.message)
          }
          return result
        }
        updatedAtRef.current = result.data.updated_at
        return { ok: true as const }
      },
      delayMs: 500,
    })
  }

  // Flush pending save on browser close / tab refresh
  useEffect(() => {
    const loop = loopRef.current
    function handler() {
      void loop?.flush()
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  // Flush on unmount — covers Next.js client-side route changes
  useEffect(() => {
    const loop = loopRef.current
    return () => {
      void loop?.flush()
    }
  }, [])

  return (
    <Plate
      editor={editor}
      // onValueChange fires only when editor.children changes (not on selection),
      // which is exactly what we want for debounced saves.
      onValueChange={({ value }) => {
        loopRef.current?.schedule(value as unknown[])
      }}
    >
      <PlateContent className="min-h-[60vh] outline-none focus-visible:outline-none" />
    </Plate>
  )
}
