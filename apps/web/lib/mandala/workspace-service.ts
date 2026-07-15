import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { Database } from "@/lib/supabase/types"

const workspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  logoPath: z.string().nullable(),
  role: z.literal("owner").optional(),
  previousLogoPath: z.string().nullable().optional(),
  version: z.number().int().positive(),
  updatedAt: z.string(),
})

export type WorkspaceIdentity = z.infer<typeof workspaceSchema>

export class WorkspaceServiceError extends Error {
  constructor(
    readonly code:
      | "company_not_found"
      | "company_version_conflict"
      | "company_update_failed"
  ) {
    super(code)
    this.name = "WorkspaceServiceError"
  }
}

export async function createWorkspaceWithOwner(
  supabase: SupabaseClient<Database>,
  name: string
) {
  const result = await callRpc(supabase, "create_company_with_owner", {
    p_name: name,
  })
  if (result.error) throw workspaceError(result.error.message)
  const parsed = workspaceSchema.safeParse(result.data)
  if (!parsed.success) throw new WorkspaceServiceError("company_update_failed")
  return parsed.data
}

export async function getWorkspaceIdentity(
  supabase: SupabaseClient<Database>,
  companyId: string
) {
  const result = await callRpc(supabase, "get_company_identity", {
    p_company_id: companyId,
  })
  if (result.error) throw workspaceError(result.error.message)
  const parsed = workspaceSchema.safeParse(result.data)
  if (!parsed.success) throw new WorkspaceServiceError("company_not_found")
  return parsed.data
}

export async function updateWorkspaceIdentity(
  supabase: SupabaseClient<Database>,
  input: {
    companyId: string
    name: string
    logoPath: string | null
    expectedVersion: number
  }
) {
  const result = await callRpc(supabase, "update_company_identity", {
    p_company_id: input.companyId,
    p_name: input.name,
    p_logo_path: input.logoPath,
    p_expected_version: input.expectedVersion,
  })
  if (result.error) throw workspaceError(result.error.message)
  const parsed = workspaceSchema.safeParse(result.data)
  if (!parsed.success) throw new WorkspaceServiceError("company_update_failed")
  return parsed.data
}

async function callRpc(
  supabase: SupabaseClient<Database>,
  name: string,
  args: Record<string, unknown>
): Promise<{ data: unknown; error: { message: string } | null }> {
  const result = await supabase.rpc(name as never, args as never)
  return result as unknown as {
    data: unknown
    error: { message: string } | null
  }
}

function workspaceError(message: string) {
  if (message.includes("company_version_conflict")) {
    return new WorkspaceServiceError("company_version_conflict")
  }
  if (message.includes("company_not_found")) {
    return new WorkspaceServiceError("company_not_found")
  }
  return new WorkspaceServiceError("company_update_failed")
}
