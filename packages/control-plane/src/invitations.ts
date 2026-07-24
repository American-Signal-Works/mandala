import { z } from "zod"
import { isoTimestampSchema } from "./schemas.js"

export const companyInvitationStateSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "expired",
])

export const companyInvitationSchema = z
  .object({
    invitationId: z.string().uuid(),
    companyId: z.string().uuid(),
    recipientEmail: z.string().email(),
    state: companyInvitationStateSchema,
    version: z.number().int().positive(),
    issuedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    deliveryId: z.string().uuid().nullable(),
  })
  .strict()

export const issueCompanyInvitationRequestSchema = z
  .object({
    companyId: z.string().uuid(),
    recipientEmail: z.string().trim().email().max(320),
  })
  .strict()

export const invitationMutationResponseSchema = z
  .object({ invitation: companyInvitationSchema })
  .strict()

export const invitationTokenRequestSchema = z
  .object({ token: z.string().min(32).max(512) })
  .strict()

export const invitationInspectionSchema = z
  .object({
    state: z.enum([
      "valid",
      "missing",
      "expired",
      "revoked",
      "used",
      "superseded",
      "accepted",
    ]),
    workspaceName: z.string().min(1).max(200).optional(),
    expiresAt: isoTimestampSchema.optional(),
  })
  .strict()

export const invitationAcceptanceSchema = z
  .object({
    invitationId: z.string().uuid(),
    companyId: z.string().uuid(),
    membershipId: z.string().uuid(),
    state: z.literal("accepted"),
    role: z.literal("owner"),
  })
  .strict()

export const companyDirectoryMemberSchema = z
  .object({
    membershipId: z.string().uuid(),
    userId: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().nullable(),
    role: z.string().min(1),
    status: z.enum(["active", "inactive"]),
    joinedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict()

export const pendingCompanyInvitationSchema = z
  .object({
    invitationId: z.string().uuid(),
    recipientEmail: z.string().email(),
    state: z.literal("pending"),
    issuedAt: isoTimestampSchema,
    expiresAt: isoTimestampSchema,
    deliveryId: z.string().uuid().nullable(),
  })
  .strict()

export const companyDirectorySchema = z
  .object({
    members: z.array(companyDirectoryMemberSchema),
    pendingInvitations: z.array(pendingCompanyInvitationSchema),
  })
  .strict()

export type CompanyInvitation = z.infer<typeof companyInvitationSchema>
export type InvitationInspection = z.infer<typeof invitationInspectionSchema>
export type InvitationAcceptance = z.infer<typeof invitationAcceptanceSchema>
export type CompanyDirectory = z.infer<typeof companyDirectorySchema>
