"use client"
import { useRef, useState } from "react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"

export function AvatarUpload({
  initialUrl,
  displayName,
  expectedVersion,
  onVersionChange,
}: {
  initialUrl: string | null
  displayName: string
  expectedVersion: number
  onVersionChange: (version: number) => void
}) {
  const [url, setUrl] = useState<string | null>(initialUrl)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.set("file", file)
      formData.set("expectedVersion", String(expectedVersion))
      const response = await fetch("/api/settings/profile/avatar", {
        method: "POST",
        body: formData,
      })
      const result = (await response.json().catch(() => null)) as {
        error?: string
        signedUrl?: string
        version?: number
      } | null
      if (!response.ok || !result?.signedUrl || !result.version) {
        toast.error(avatarErrorMessage(result?.error))
        return
      }
      setUrl(result.signedUrl)
      onVersionChange(result.version)
      toast.success("Avatar updated.")
    } catch {
      toast.error("The avatar could not be updated. Try again.")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        {url && <AvatarImage src={url} alt="" />}
        <AvatarFallback>
          {displayName.slice(0, 2).toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "Uploading…" : "Change avatar"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={onPick}
      />
    </div>
  )
}

function avatarErrorMessage(code: string | undefined) {
  if (code === "image_too_large") return "Choose an image smaller than 5 MB."
  if (
    code === "image_type_unsupported" ||
    code === "image_signature_invalid" ||
    code === "image_decode_failed"
  ) {
    return "Choose a valid PNG or JPEG image."
  }
  if (code === "profile_version_conflict") {
    return "Your profile changed in another session. Refresh and try again."
  }
  return "The avatar could not be updated. Try again."
}
