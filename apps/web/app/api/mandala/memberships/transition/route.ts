import { NextResponse } from "next/server"
import {
  membershipTransitionCommandSchema,
  membershipTransitionResponseSchema,
} from "@workspace/control-plane"
import {
  authorizeCompanyPermission,
  companyPermissionFailure,
} from "@/lib/mandala/authorization"
import {
  classifyMembershipTransitionError,
  transitionCompanyMembershipRpc,
} from "@/lib/mandala/memberships"
import { authenticateRequest } from "@/lib/supabase/request"

const privateHeaders = { "cache-control": "private, no-store" }

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )
  }

  const parsed = membershipTransitionCommandSchema.safeParse(
    await parseJson(request)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400, headers: privateHeaders }
    )
  }

  if (
    parsed.data.action === "leave" &&
    parsed.data.targetUserId !== auth.user.id
  ) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: privateHeaders }
    )
  }

  const permissionFailure = companyPermissionFailure(
    await authorizeCompanyPermission({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
      permission:
        parsed.data.action === "leave"
          ? "company.context.read"
          : "membership.manage",
    })
  )
  if (permissionFailure) {
    return NextResponse.json(
      { error: permissionFailure.code },
      {
        status: permissionFailure.status,
        headers: privateHeaders,
      }
    )
  }

  try {
    const membership = await transitionCompanyMembershipRpc({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      targetUserId: parsed.data.targetUserId,
      action: parsed.data.action,
      requestedRole: parsed.data.requestedRole,
    })
    return NextResponse.json(
      membershipTransitionResponseSchema.parse(membership),
      {
        headers: privateHeaders,
      }
    )
  } catch (error) {
    const response = classifyMembershipTransitionError(error)
    return NextResponse.json(
      { error: response.code },
      { status: response.status, headers: privateHeaders }
    )
  }
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}
