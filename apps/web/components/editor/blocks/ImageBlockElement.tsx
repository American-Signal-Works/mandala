// apps/web/components/editor/blocks/ImageBlockElement.tsx
"use client"
import { useState } from "react"
import { PlateElement } from "platejs/react"
import { uploadImage } from "@/actions/upload"

export type ImageBlockProps = {
  storagePath: string
  url: string
  caption?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ImageBlockElement(props: any) {
  const element = props.element as { id?: string; imageProps?: ImageBlockProps }
  const cfg: ImageBlockProps | null = element.imageProps ?? null
  const [uploading, setUploading] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.set("file", file)
    const result = await uploadImage(fd)
    setUploading(false)
    if (!result.ok) return
    props.editor.tf.setNodes(
      { imageProps: { storagePath: result.data.path, url: result.data.url } },
      { at: props.path }
    )
  }

  return (
    <PlateElement {...props}>
      <div className="my-2" contentEditable={false}>
        {cfg?.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URLs aren't optimizable by next/image without remote pattern config
          <img
            src={cfg.url}
            alt={cfg.caption ?? ""}
            className="max-w-full rounded border"
          />
        ) : (
          <label className="block cursor-pointer rounded border-2 border-dashed p-8 text-center hover:bg-muted">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPick}
            />
            <span className="text-sm text-muted-foreground">
              {uploading ? "Uploading…" : "Click to upload an image"}
            </span>
          </label>
        )}
      </div>
      {props.children}
    </PlateElement>
  )
}
