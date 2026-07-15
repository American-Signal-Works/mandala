import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  companyDirectorySchema,
  companyInvitationSchema,
  invitationAcceptanceSchema,
  invitationInspectionSchema,
  type CompanyDirectory,
  type CompanyInvitation,
  type InvitationAcceptance,
  type InvitationInspection,
} from "@workspace/control-plane"
import type { Database } from "@/lib/supabase/types"
import { invitationToken, invitationTokenDigest } from "./invitation-token"

type DatabaseClient = SupabaseClient<Database>

export class CompanyInvitationError extends Error {
  constructor(
    readonly code: string,
    readonly providerCode?: string
  ) {
    super(code)
    this.name = "CompanyInvitationError"
  }
}

export async function issueCompanyInvitation(input: {
  supabase: DatabaseClient
  companyId: string
  recipientEmail: string
}): Promise<CompanyInvitation> {
  const invitationId = randomUUID()
  const token = invitationToken({ invitationId, version: 1 })
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000).toISOString()
  const { data, error } = await input.supabase.rpc("issue_company_invitation", {
    p_invitation_id: invitationId,
    p_company_id: input.companyId,
    p_recipient_email: input.recipientEmail,
    p_token_digest: invitationTokenDigest(token),
    p_expires_at: expiresAt,
  })
  if (error) throw invitationErrorFromRpc(error)
  return companyInvitationSchema.parse(data)
}

export async function resendCompanyInvitation(input: {
  supabase: DatabaseClient
  invitationId: string
}): Promise<CompanyInvitation> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: nextVersion, error: lookupError } = await input.supabase.rpc(
      "get_company_invitation_resend_version",
      { p_invitation_id: input.invitationId }
    )
    if (lookupError) throw invitationErrorFromRpc(lookupError)
    if (!nextVersion) throw new CompanyInvitationError("invitation_not_found")
    const token = invitationToken({
      invitationId: input.invitationId,
      version: nextVersion,
    })
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1_000).toISOString()
    const { data, error } = await input.supabase.rpc(
      "resend_company_invitation",
      {
        p_invitation_id: input.invitationId,
        p_token_digest: invitationTokenDigest(token),
        p_expires_at: expiresAt,
        p_expected_version: nextVersion,
      }
    )
    if (!error) return companyInvitationSchema.parse(data)

    const mapped = invitationErrorFromRpc(error)
    if (mapped.code !== "invitation_version_conflict" || attempt === 1) {
      throw mapped
    }
  }

  throw new CompanyInvitationError("invitation_version_conflict")
}

export async function revokeCompanyInvitation(input: {
  supabase: DatabaseClient
  invitationId: string
}): Promise<CompanyInvitation> {
  const { data, error } = await input.supabase.rpc(
    "revoke_company_invitation",
    { p_invitation_id: input.invitationId }
  )
  if (error) throw invitationErrorFromRpc(error)
  return companyInvitationSchema.parse(data)
}

export async function inspectCompanyInvitation(input: {
  supabase: DatabaseClient
  token: string
}): Promise<InvitationInspection> {
  const { data, error } = await input.supabase.rpc(
    "inspect_company_invitation",
    { p_token_digest: invitationTokenDigest(input.token) }
  )
  if (error) throw invitationErrorFromRpc(error)
  return invitationInspectionSchema.parse(data)
}

export async function acceptCompanyInvitation(input: {
  supabase: DatabaseClient
  token: string
}): Promise<InvitationAcceptance> {
  const { data, error } = await input.supabase.rpc(
    "accept_company_invitation",
    {
      p_token_digest: invitationTokenDigest(input.token),
    }
  )
  if (error) throw invitationErrorFromRpc(error)
  return invitationAcceptanceSchema.parse(data)
}

export async function listCompanyDirectory(input: {
  supabase: DatabaseClient
  companyId: string
}): Promise<CompanyDirectory> {
  const { data, error } = await input.supabase.rpc("list_company_directory", {
    p_company_id: input.companyId,
  })
  if (error) throw invitationErrorFromRpc(error)
  return companyDirectorySchema.parse(data)
}

export function invitationErrorFromRpc(error: {
  code?: string
  message?: string
}) {
  const safeCode = safeInvitationCode(error.message)
  return new CompanyInvitationError(safeCode, error.code)
}

function safeInvitationCode(message?: string): string {
  const candidate = message?.match(
    /(session_replacement_required|active_invitation_exists|already_active_member|invitation_(?:forbidden|not_found|not_pending|missing|expired|revoked|used|superseded|accepted|version_conflict)|invalid_invitation|company_not_found)/
  )?.[1]
  return candidate ?? "invitation_failed"
}
