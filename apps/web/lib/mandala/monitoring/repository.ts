import type {
  EscalationRecord,
  FollowUpRecord,
  FollowUpScheduleRequest,
  MonitoringDecision,
  MonitoringLease,
} from "./schema"

export interface FollowUpSchedulerRepository {
  schedule(input: {
    request: FollowUpScheduleRequest
    actorId: string
  }): Promise<FollowUpRecord>
}

export interface MonitoringWorkerRepository {
  claimDue(input: {
    workerId: string
    limit: number
    leaseSeconds: number
    now: string
  }): Promise<MonitoringLease[]>
  completeClaim(input: {
    workerId: string
    lease: MonitoringLease
    decision: MonitoringDecision
  }): Promise<{ escalation: EscalationRecord | null; duplicate: boolean }>
  failClaim(input: {
    workerId: string
    lease: MonitoringLease
    retryable: boolean
    errorCode: string
  }): Promise<void>
}

export interface MonitoringRepository
  extends FollowUpSchedulerRepository, MonitoringWorkerRepository {}

export class MonitoringRepositoryError extends Error {
  constructor(
    readonly code:
      | "follow_up_not_found"
      | "lease_lost"
      | "stale_version"
      | "repository_unavailable"
      | "repository_invalid_response",
    options?: { cause?: unknown }
  ) {
    super(code, options)
    this.name = "MonitoringRepositoryError"
  }
}
