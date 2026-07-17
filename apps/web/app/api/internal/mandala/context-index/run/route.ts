import { timingSafeEqual } from "node:crypto"
import { prepareContextIndexMaintenance } from "@/actions/admin/context-index-maintenance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const privateHeaders = { "cache-control": "private, no-store" }
const disabledBatch = {
  claimed: 0,
  completed: 0,
  retryScheduled: 0,
  deadLettered: 0,
  reconciliationRequired: 0,
  leaseUnresolved: 0,
  results: [],
} as const

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )
  }
  if (!(await hasEmptyBody(request))) {
    return Response.json(
      { error: "invalid_request" },
      { status: 400, headers: privateHeaders }
    )
  }

  try {
    const preparation = await prepareContextIndexMaintenance()
    // Slice 4 has no provider adapter. Maintenance may recover expired leases,
    // but this shipped endpoint cannot claim or dispatch provider work.
    return Response.json(
      { preparation, batch: disabledBatch, providerOperational: false },
      { headers: privateHeaders }
    )
  } catch {
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
  const expected = process.env.CONTEXT_INDEX_WORKER_SECRET?.trim() ?? ""
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    expectedBytes.length >= 32 &&
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}
