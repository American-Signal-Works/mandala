import { timingSafeEqual } from "node:crypto"
import { runContextIndexMaintenance } from "@/actions/admin/context-index-maintenance"

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
    return Response.json(await runContextIndexMaintenance(), {
      headers: privateHeaders,
    })
  } catch (error) {
    console.error("Context index worker failed.", error)
    return Response.json(
      { error: "context_index_worker_failed" },
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
    process.env.CONTEXT_INDEX_WORKER_SECRET,
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
