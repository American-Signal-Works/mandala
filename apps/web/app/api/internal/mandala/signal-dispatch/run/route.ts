import { timingSafeEqual } from "node:crypto"
import { runSignalDispatchMaintenance } from "@/actions/admin/signal-dispatch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

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
    return Response.json(await runSignalDispatchMaintenance(), {
      headers: privateHeaders,
    })
  } catch (error) {
    console.error("Signal dispatch worker failed.", error)
    return Response.json(
      { error: "signal_dispatch_worker_failed" },
      { status: 500, headers: privateHeaders }
    )
  }
}

async function hasEmptyBody(request: Request) {
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
    process.env.SIGNAL_DISPATCH_WORKER_SECRET,
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
