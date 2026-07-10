import { NextResponse } from "next/server"
import { workItemDetailResponseSchema } from "@workspace/control-plane"
import { z } from "zod"
import {
  ControlPlaneQueryError,
  getWorkflowItemDetail,
} from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"

const requestSchema = z.object({
  companyId: z.string().uuid(),
  itemId: z.string().uuid(),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const parsed = requestSchema.safeParse({
    companyId: url.searchParams.get("companyId"),
    itemId: (await context.params).itemId,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  try {
    const detail = await getWorkflowItemDetail({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      itemId: parsed.data.itemId,
    })
    return NextResponse.json(workItemDetailResponseSchema.parse(detail), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    if (
      error instanceof ControlPlaneQueryError &&
      error.code === "item_not_found"
    ) {
      return NextResponse.json({ error: "item_not_found" }, { status: 404 })
    }
    return NextResponse.json({ error: "item_detail_failed" }, { status: 500 })
  }
}
