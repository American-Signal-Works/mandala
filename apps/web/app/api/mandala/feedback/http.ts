import { NextResponse } from "next/server"

export function feedbackJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  })
}

export async function parseFeedbackJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
