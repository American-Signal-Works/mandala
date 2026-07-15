import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  invitationAcceptanceSchema,
  type InvitationAcceptance,
} from "@workspace/control-plane"
import { createInvitationHandoffAdminClient } from "@/actions/admin/invitation-handoff"
import type { Database } from "@/lib/supabase/types"
import {
  CompanyInvitationError,
  invitationErrorFromRpc,
} from "./invitations"
import { invitationTokenDigest } from "./invitation-token"

export const INVITATION_HANDOFF_COOKIE = "mandala-invitation-handoff"
export const INVITATION_HANDOFF_MAX_AGE_SECONDS = 60 * 60

type DatabaseClient = SupabaseClient<Database>

export async function createInvitationHandoff(
  token: string
): Promise<{ tokenRecordId: string }> {
  const admin = createInvitationHandoffAdminClient()
  const { data: tokenRecord, error: tokenError } = await admin
    .from("company_invitation_tokens")
    .select("id, invitation_id, state, expires_at")
    .eq("token_digest", invitationTokenDigest(token))
    .maybeSingle()

  if (tokenError || !tokenRecord) {
    throw new CompanyInvitationError("invitation_missing")
  }
  if (tokenRecord.state !== "active") {
    throw new CompanyInvitationError(`invitation_${tokenRecord.state}`)
  }
  if (Date.parse(tokenRecord.expires_at) <= Date.now()) {
    throw new CompanyInvitationError("invitation_expired")
  }

  const { data: invitation, error: invitationError } = await admin
    .from("company_invitations")
    .select("state, expires_at")
    .eq("id", tokenRecord.invitation_id)
    .maybeSingle()
  if (invitationError || !invitation) {
    throw new CompanyInvitationError("invitation_missing")
  }
  if (invitation.state !== "pending") {
    throw new CompanyInvitationError(`invitation_${invitation.state}`)
  }
  if (Date.parse(invitation.expires_at) <= Date.now()) {
    throw new CompanyInvitationError("invitation_expired")
  }

  // The browser receives only this random database row id. The raw invitation
  // token and its digest remain server-side.
  return { tokenRecordId: tokenRecord.id }
}

export async function acceptInvitationHandoff(input: {
  supabase: DatabaseClient
  tokenRecordId: string
}): Promise<InvitationAcceptance> {
  const admin = createInvitationHandoffAdminClient()
  const { data: tokenRecord, error: lookupError } = await admin
    .from("company_invitation_tokens")
    .select("token_digest, state, expires_at")
    .eq("id", input.tokenRecordId)
    .maybeSingle()

  if (lookupError || !tokenRecord) {
    throw new CompanyInvitationError("invitation_missing")
  }
  if (tokenRecord.state !== "active") {
    throw new CompanyInvitationError(`invitation_${tokenRecord.state}`)
  }
  if (Date.parse(tokenRecord.expires_at) <= Date.now()) {
    throw new CompanyInvitationError("invitation_expired")
  }

  const { data, error } = await input.supabase.rpc(
    "accept_company_invitation",
    { p_token_digest: tokenRecord.token_digest }
  )
  if (error) throw invitationErrorFromRpc(error)
  return invitationAcceptanceSchema.parse(data)
}
