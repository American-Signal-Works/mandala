import { NextResponse } from "next/server"
import { workItemListResponseSchema } from "@workspace/control-plane"
import { z } from "zod"
import { listWorkflowItems } from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"

const workflowItemStatuses = [
  "active",
  "blocked",
  "approved",
  "rejected",
  "executed",
  "resolved",
] as const
const querySchema = z.object({
  companyId: z.string().uuid(),
  status: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(
      z
        .array(z.enum(workflowItemStatuses))
        .min(1)
        .max(workflowItemStatuses.length)
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    companyId: url.searchParams.get("companyId"),
    status: url.searchParams.get("status") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  try {
    const items = await listWorkflowItems({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      statuses: parsed.data.status,
      limit: parsed.data.limit,
    })
    return NextResponse.json(workItemListResponseSchema.parse({ items }), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch {
    return NextResponse.json({ error: "item_list_failed" }, { status: 500 })
  }
}
