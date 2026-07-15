// @vitest-environment node

import sharp from "sharp"
import { describe, expect, it } from "vitest"
import {
  ImageUploadError,
  MAX_FIRST_PARTY_IMAGE_BYTES,
  processFirstPartyImage,
} from "./image-upload"

function uploadLike(bytes: Buffer, type: string) {
  return {
    type,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer
    },
  }
}

describe("first-party image processing", () => {
  it("decodes and re-encodes avatars to an exact safe square", async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: "#4f46e5",
      },
    })
      .jpeg()
      .toBuffer()

    const result = await processFirstPartyImage(
      uploadLike(source, "image/jpeg"),
      "avatar"
    )

    expect(result).toMatchObject({
      contentType: "image/jpeg",
      extension: "jpg",
      width: 512,
      height: 512,
    })
    expect(result.bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  })

  it("preserves a logo's aspect ratio and never enlarges it", async () => {
    const source = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer()

    const result = await processFirstPartyImage(
      uploadLike(source, "image/png"),
      "workspace-logo"
    )

    expect(result).toMatchObject({
      contentType: "image/png",
      extension: "png",
      width: 800,
      height: 400,
    })
  })

  it("rejects spoofed, corrupt, unsupported, and oversized inputs", async () => {
    await expect(
      processFirstPartyImage(
        uploadLike(Buffer.from("not a png"), "image/png"),
        "avatar"
      )
    ).rejects.toMatchObject({ code: "image_signature_invalid" })

    await expect(
      processFirstPartyImage(
        uploadLike(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"),
        "avatar"
      )
    ).rejects.toMatchObject({ code: "image_decode_failed" })

    await expect(
      processFirstPartyImage(
        uploadLike(Buffer.from("gif"), "image/gif"),
        "avatar"
      )
    ).rejects.toBeInstanceOf(ImageUploadError)

    await expect(
      processFirstPartyImage(
        {
          type: "image/png",
          size: MAX_FIRST_PARTY_IMAGE_BYTES + 1,
          async arrayBuffer() {
            return new ArrayBuffer(0)
          },
        },
        "avatar"
      )
    ).rejects.toMatchObject({ code: "image_too_large" })
  })
})
