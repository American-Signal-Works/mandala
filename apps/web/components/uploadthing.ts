/* eslint-disable @typescript-eslint/no-explicit-any */
// Stub for uploadthing file router — configure in a later task when media uploads are needed
import type { FileRouter } from "uploadthing/next"

import { createUploadthing } from "uploadthing/next"

const f = createUploadthing()

export const ourFileRouter: FileRouter = {
  editorUploader: f({ image: { maxFileSize: "4MB" } })
    .middleware(() => ({}))
    .onUploadComplete(() => {}),
} as any

export type OurFileRouter = typeof ourFileRouter
