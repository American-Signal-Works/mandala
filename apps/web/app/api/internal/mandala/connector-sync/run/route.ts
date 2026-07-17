import { timingSafeEqual } from "node:crypto"
import { runConnectorSync } from "@/actions/admin/connector-sync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const privateHeaders = { "cache-control": "private, no-store" }
export async function POST(request: Request) {
  return run(request, true)
}

export async function GET(request: Request) {
  return run(request, false)
}

async function run(request: Request, validateBody: boolean) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )
  }
  if (validateBody && !(await hasEmptyBody(request))) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: privateHeaders }
    )
  }

  try {
    return Response.json(await runConnectorSync(), {
      headers: privateHeaders,
    })
  } catch {
    return Response.json(
      { error: "connector_sync_worker_failed" },
      { status: 500, headers: privateHeaders }
    )
  }
}

async function hasEmptyBody(request: Request): Promise<boolean> {
  const body = (await request.text()).trim()
  return body === "" || body === "{}"
}

function isAuthorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : ""
  const suppliedBytes = Buffer.from(supplied)
  return [
    process.env.CONNECTOR_SYNC_WORKER_SECRET,
    process.env.CRON_SECRET,
  ].some((candidate) => {
    const expectedBytes = Buffer.from(candidate?.trim() ?? "")
    return (
      expectedBytes.length >= 32 &&
      suppliedBytes.length === expectedBytes.length &&
      timingSafeEqual(suppliedBytes, expectedBytes)
    )
  })
}
