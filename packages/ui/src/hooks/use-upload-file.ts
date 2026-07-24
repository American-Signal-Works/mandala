import * as React from "react"

import { toast } from "sonner"
import { z } from "zod"

export type UploadedFile<T = unknown> = {
  key: string
  url: string
  name: string
  size: number
  type: string
  customId?: string
  appUrl?: string
  fileHash?: string
  ufsUrl?: string
  serverData?: T
}

interface UseUploadFileProps {
  onUploadComplete?: (file: UploadedFile) => void
  onUploadError?: (error: unknown) => void
  headers?: Record<string, string>
  onUploadBegin?: (fileName: string) => void
  onUploadProgress?: (p: { progress: number }) => void
  skipPolling?: boolean
}

export function useUploadFile({
  onUploadComplete,
  onUploadError,
}: UseUploadFileProps = {}) {
  const [uploadedFile, setUploadedFile] = React.useState<UploadedFile>()
  const [uploadingFile, setUploadingFile] = React.useState<File>()
  const [progress, setProgress] = React.useState<number>(0)
  const [isUploading, setIsUploading] = React.useState(false)

  async function uploadThing(file: File) {
    setIsUploading(true)
    setUploadingFile(file)

    try {
      // Mock upload — replace with real uploadthing integration when configured
      let mockProgress = 0
      while (mockProgress < 100) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        mockProgress += 10
        setProgress(Math.min(mockProgress, 100))
      }

      const mockUploadedFile: UploadedFile = {
        key: `mock-key-${Date.now()}`,
        url: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
        type: file.type,
      }

      setUploadedFile(mockUploadedFile)
      onUploadComplete?.(mockUploadedFile)

      return mockUploadedFile
    } catch (error) {
      toast.error(getErrorMessage(error))
      onUploadError?.(error)
    } finally {
      setProgress(0)
      setIsUploading(false)
      setUploadingFile(undefined)
    }
  }

  return {
    isUploading,
    progress,
    uploadedFile,
    uploadFile: uploadThing,
    uploadingFile,
  }
}

export function getErrorMessage(err: unknown) {
  if (err instanceof z.ZodError) {
    return err.issues.map((i) => i.message).join("\n")
  }
  if (err instanceof Error) return err.message
  return "Something went wrong, please try again later."
}
