import { z } from "zod"

const safeRecordSchema = z.record(z.string(), z.unknown())

export const signalKindSchema = z.enum([
  "record_change",
  "schedule",
  "reconciliation",
])
export const signalExecutionModeSchema = z.enum(["mock", "dry_run", "shadow"])

export const signalDispatchSchema = z
  .object({
    id: z.string().uuid(),
    companyId: z.string().uuid(),
    workflowId: z.string().uuid(),
    bindingSnapshotId: z.string().uuid(),
    changeWindowId: z.string().uuid().nullable(),
    triggerId: z
      .string()
      .min(1)
      .max(150)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    triggerKind: z.enum(["schedule", "webhook"]),
    signalKind: signalKindSchema,
    executionMode: signalExecutionModeSchema,
    trigger: safeRecordSchema,
    input: safeRecordSchema,
    attempt: z.number().int().positive().max(20),
    maxAttempts: z.number().int().positive().max(20),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((dispatch, context) => {
    if (
      (dispatch.signalKind === "record_change") !==
      (dispatch.changeWindowId !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["changeWindowId"],
        message: "Only record-change signals reference a change window.",
      })
    }
  })

export const signalLeaseSchema = z
  .object({
    leaseId: z.string().uuid(),
    dispatch: signalDispatchSchema,
  })
  .strict()

export const signalExecutionOutcomeSchema = z
  .object({
    status: z.enum(["completed", "suppressed"]),
    result: safeRecordSchema,
  })
  .strict()

export type SignalDispatch = z.infer<typeof signalDispatchSchema>
export type SignalLease = z.infer<typeof signalLeaseSchema>
export type SignalExecutionOutcome = z.infer<
  typeof signalExecutionOutcomeSchema
>
