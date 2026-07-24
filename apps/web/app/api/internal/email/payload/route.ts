import { timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { createEmailPayloadAdminClient } from "@/actions/admin/email-payload"
import {
  createInviteAcceptedEmailPayload,
  createWorkspaceInviteEmailPayload,
} from "@/lib/auth/transactional-email"
import { invitationToken } from "@/lib/mandala/invitation-token"

const requestSchema = z
  .object({
    companyId: z.string().uuid(),
    templateKey: z.enum(["workspace_invite", "workspace_invite_accepted"]),
    templateVersion: z.literal("1"),
    payloadReference: z.string().min(1).max(200),
  })
  .strict()

const invitationReference = /^company_invitation:([0-9a-f-]{36}):(\d+)$/
const acceptedReference = /^company_invitation_accepted:([0-9a-f-]{36})$/

export async function POST(request: Request) {
  if (!isAuthorized(request))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return Response.json({ error: "invalid_request" }, { status: 400 })
  try {
    const rendered = await resolveInvitationPayload(parsed.data)
    return Response.json(rendered, {
      headers: { "cache-control": "private, no-store" },
    })
  } catch (error) {
    const code =
      error instanceof PayloadResolutionError
        ? error.code
        : "payload_unavailable"
    const status = code === "payload_not_found" ? 404 : 422
    return Response.json({ error: code }, { status })
  }
}

async function resolveInvitationPayload(input: z.infer<typeof requestSchema>) {
  const admin = createEmailPayloadAdminClient()
  const fromAddress = requiredEnvironment("RESEND_AUTH_EMAIL_FROM_ADDRESS")

  if (input.templateKey === "workspace_invite") {
    const reference = invitationReference.exec(input.payloadReference)
    if (!reference)
      throw new PayloadResolutionError("invalid_payload_reference")
    const [, invitationId, versionText] = reference
    const version = Number(versionText)
    const { data: invitation, error } = await admin
      .from("company_invitations")
      .select(
        "id, company_id, recipient_email, inviter_user_id, version, state"
      )
      .eq("id", invitationId!)
      .eq("company_id", input.companyId)
      .maybeSingle()
    if (
      error ||
      !invitation ||
      invitation.version !== version ||
      invitation.state !== "pending"
    ) {
      throw new PayloadResolutionError("payload_not_found")
    }
    const [{ data: company }, { data: inviterProfile }] = await Promise.all([
      admin
        .from("companies")
        .select("name")
        .eq("id", input.companyId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("display_name")
        .eq("user_id", invitation.inviter_user_id)
        .maybeSingle(),
    ])
    if (!company) throw new PayloadResolutionError("payload_not_found")
    const token = invitationToken({ invitationId: invitation.id, version })
    const siteUrl = new URL(requiredEnvironment("NEXT_PUBLIC_SITE_URL"))
    siteUrl.pathname = "/invitation"
    siteUrl.search = new URLSearchParams({ token }).toString()
    const payload = createWorkspaceInviteEmailPayload({
      actionUrl: siteUrl.toString(),
      fromAddress,
      inviterName: inviterProfile?.display_name?.trim() || "A workspace owner",
      recipientEmail: invitation.recipient_email,
      workspaceName: company.name,
      workspaceLogoUrl: null,
    })
    return withoutRecipient(payload)
  }

  const reference = acceptedReference.exec(input.payloadReference)
  if (!reference) throw new PayloadResolutionError("invalid_payload_reference")
  const invitationId = reference[1]!
  const { data: invitation, error } = await admin
    .from("company_invitations")
    .select("company_id, inviter_user_id, accepted_user_id, state")
    .eq("id", invitationId)
    .eq("company_id", input.companyId)
    .maybeSingle()
  if (
    error ||
    !invitation ||
    invitation.state !== "accepted" ||
    !invitation.accepted_user_id
  ) {
    throw new PayloadResolutionError("payload_not_found")
  }
  const [{ data: company }, { data: memberProfile }, { data: inviter }] =
    await Promise.all([
      admin
        .from("companies")
        .select("name")
        .eq("id", input.companyId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("display_name")
        .eq("user_id", invitation.accepted_user_id)
        .maybeSingle(),
      admin.auth.admin.getUserById(invitation.inviter_user_id),
    ])
  if (!company || !inviter.user?.email)
    throw new PayloadResolutionError("payload_not_found")
  return withoutRecipient(
    createInviteAcceptedEmailPayload({
      fromAddress,
      inviterEmail: inviter.user.email,
      memberName: memberProfile?.display_name?.trim() || "A new member",
      workspaceName: company.name,
      workspaceLogoUrl: null,
    })
  )
}

function withoutRecipient<T extends { to: string[] }>(
  payload: T
): Omit<T, "to"> {
  const rendered = { ...payload } as Partial<T>
  delete rendered.to
  return rendered as Omit<T, "to">
}

function isAuthorized(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : ""
  const expected = process.env.EMAIL_PAYLOAD_RESOLVER_SECRET?.trim() ?? ""
  const suppliedBytes = Buffer.from(supplied)
  const expectedBytes = Buffer.from(expected)
  return (
    suppliedBytes.length > 0 &&
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  )
}

function requiredEnvironment(
  name: "RESEND_AUTH_EMAIL_FROM_ADDRESS" | "NEXT_PUBLIC_SITE_URL"
) {
  const value = process.env[name]?.trim()
  if (!value) throw new PayloadResolutionError("payload_configuration_missing")
  return value
}

class PayloadResolutionError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
