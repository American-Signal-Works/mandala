/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FileRouter } from "uploadthing/next"

import { createUploadthing } from "uploadthing/next"

const f = createUploadthing()

// Cast to any to avoid "cannot be named" TS4055 error from @uploadthing/shared
export const ourFileRouter: FileRouter = {
  editorUploader: f(["image", "text", "blob", "pdf", "video", "audio"])
    .middleware(() => ({}))
    .onUploadComplete(({ file }) => ({
      key: file.key,
      name: file.name,
      size: file.size,
      type: file.type,
      url: file.ufsUrl,
    })),
} as any

export type OurFileRouter = typeof ourFileRouter
