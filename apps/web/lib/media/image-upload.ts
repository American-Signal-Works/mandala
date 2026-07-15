import "server-only"

import sharp from "sharp"

export const MAX_FIRST_PARTY_IMAGE_BYTES = 5 * 1024 * 1024

export type ImagePurpose = "avatar" | "workspace-logo"

export class ImageUploadError extends Error {
  constructor(
    readonly code:
      | "image_missing"
      | "image_too_large"
      | "image_type_unsupported"
      | "image_signature_invalid"
      | "image_decode_failed"
  ) {
    super(code)
    this.name = "ImageUploadError"
  }
}

type UploadLike = {
  arrayBuffer(): Promise<ArrayBuffer>
  size: number
  type: string
}

export type ProcessedImage = {
  bytes: Buffer
  contentType: "image/jpeg" | "image/png"
  extension: "jpg" | "png"
  height: number
  width: number
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export async function processFirstPartyImage(
  file: UploadLike | null | undefined,
  purpose: ImagePurpose
): Promise<ProcessedImage> {
  if (!file || file.size <= 0) throw new ImageUploadError("image_missing")
  if (file.size > MAX_FIRST_PARTY_IMAGE_BYTES) {
    throw new ImageUploadError("image_too_large")
  }
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    throw new ImageUploadError("image_type_unsupported")
  }

  const source = Buffer.from(await file.arrayBuffer())
  const detectedType = detectImageType(source)
  if (detectedType !== file.type) {
    throw new ImageUploadError("image_signature_invalid")
  }

  try {
    const dimension = purpose === "avatar" ? 512 : 1024
    let pipeline = sharp(source, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    }).rotate()

    pipeline =
      purpose === "avatar"
        ? pipeline.resize(dimension, dimension, {
            fit: "cover",
            position: "centre",
          })
        : pipeline.resize(dimension, dimension, {
            fit: "inside",
            withoutEnlargement: true,
          })

    const encoded =
      detectedType === "image/png"
        ? pipeline.png({ compressionLevel: 9 }).toBuffer({
            resolveWithObject: true,
          })
        : pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer({
            resolveWithObject: true,
          })

    const result = await encoded
    if (!result.info.width || !result.info.height) {
      throw new ImageUploadError("image_decode_failed")
    }

    return {
      bytes: result.data,
      contentType: detectedType,
      extension: detectedType === "image/png" ? "png" : "jpg",
      width: result.info.width,
      height: result.info.height,
    }
  } catch (error) {
    if (error instanceof ImageUploadError) throw error
    throw new ImageUploadError("image_decode_failed")
  }
}

function detectImageType(buffer: Buffer): "image/jpeg" | "image/png" | null {
  if (
    buffer.length >= pngSignature.length &&
    buffer.subarray(0, 8).equals(pngSignature)
  ) {
    return "image/png"
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg"
  }
  return null
}
