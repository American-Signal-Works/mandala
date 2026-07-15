import { timingSafeEqual } from "node:crypto"
import { retryPendingAccountDeletionCleanup } from "@/actions/admin/account-deletion-cleanup"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )
  }

  try {
    return Response.json(await retryPendingAccountDeletionCleanup(), {
      headers: privateHeaders,
    })
  } catch {
    return Response.json(
      { error: "account_deletion_cleanup_failed" },
      { status: 500, headers: privateHeaders }
    )
  }
}

const privateHeaders = { "cache-control": "private, no-store" }

function isAuthorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : ""
  const expected = process.env.ACCOUNT_DELETION_WORKER_SECRET?.trim() ?? ""
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    expectedBytes.length >= 32 &&
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}
