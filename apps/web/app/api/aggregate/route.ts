// apps/web/app/api/aggregate/route.ts
import { NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { Collection } from "@/lib/collections/collection"

const MetricSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count") }),
  z.object({ kind: z.literal("sum"), fieldId: z.string() }),
  z.object({ kind: z.literal("avg"), fieldId: z.string() }),
  z.object({ kind: z.literal("min"), fieldId: z.string() }),
  z.object({ kind: z.literal("max"), fieldId: z.string() }),
])

const BodySchema = z.object({
  collectionId: z.string().uuid(),
  metric: MetricSchema,
  groupBy: z.array(z.string()).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const raw = await request.json()
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 }
    )

  try {
    const collection = await Collection.load(parsed.data.collectionId)
    const result = await collection.aggregate({
      metric: parsed.data.metric,
      groupBy: parsed.data.groupBy,
    })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
