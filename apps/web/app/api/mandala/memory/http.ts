import { NextResponse } from "next/server"
import { z } from "zod"
import { MemoryProviderError } from "@/lib/mandala/memory"

export function memoryJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  })
}

export async function parseMemoryJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function memoryError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError)
    return memoryJson(
      { error: "invalid_request", issues: error.flatten().fieldErrors },
      400
    )
  if (error instanceof MemoryProviderError) {
    const statuses = {
      candidate_not_found: 404,
      invalid_state: 409,
      stale_version: 409,
      provider_unavailable: 503,
      provider_invalid_response: 502,
    } as const
    return memoryJson({ error: error.code }, statuses[error.code])
  }
  return memoryJson({ error: fallback }, 500)
}
