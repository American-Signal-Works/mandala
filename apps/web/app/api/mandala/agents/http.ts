import { NextResponse } from "next/server"

export function agentJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  })
}

export async function parseAgentJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

export function canManageAgents(role: string): boolean {
  return role === "owner" || role === "admin"
}
