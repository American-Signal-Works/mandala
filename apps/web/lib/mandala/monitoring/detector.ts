import {
  monitoringDecisionSchema,
  type FollowUpObservation,
  type FollowUpRecord,
  type MonitoringDecision,
} from "./schema"

export function evaluateFollowUp(input: {
  followUp: FollowUpRecord
  observation: FollowUpObservation
  now: Date
}): MonitoringDecision {
  const { followUp, observation, now } = input
  const activeKey = createActiveEscalationKey(followUp)
  const evaluatedAt = now.toISOString()

  if (observation.resolvedAt || observation.sourceStatus === "resolved") {
    return monitoringDecisionSchema.parse({
      qualifies: false,
      activeKey,
      reason: "source_resolved",
      evaluatedAt,
    })
  }

  if (new Date(followUp.dueAt) > now) {
    return monitoringDecisionSchema.parse({
      qualifies: false,
      activeKey,
      reason: "not_due",
      evaluatedAt,
    })
  }

  const qualifies = conditionQualifies(followUp, observation, now)
  return monitoringDecisionSchema.parse({
    qualifies,
    activeKey,
    reason: qualifies
      ? detectionReason(followUp.condition.type)
      : "condition_clear",
    evaluatedAt,
  })
}

export function createActiveEscalationKey(followUp: FollowUpRecord): string {
  const base = [
    followUp.companyId,
    followUp.sourceItemId,
    followUp.ruleVersion,
    followUp.condition.type,
  ].join(":")
  return followUp.recurrencePolicy === "new_occurrence"
    ? `${base}:${followUp.occurrence}`
    : base
}

function conditionQualifies(
  followUp: FollowUpRecord,
  observation: FollowUpObservation,
  now: Date
): boolean {
  switch (followUp.condition.type) {
    case "failure":
      return new Set(["failed", "unknown", "reconciliation_required"]).has(
        observation.sourceStatus
      )
    case "overdue":
      return !new Set(["succeeded", "resolved", "suppressed"]).has(
        observation.sourceStatus
      )
    case "stale": {
      const staleAt =
        new Date(observation.lastActivityAt).getTime() +
        followUp.condition.staleAfterMinutes * 60_000
      return staleAt <= now.getTime()
    }
    case "unresolved":
      return !new Set(["succeeded", "resolved", "suppressed"]).has(
        observation.sourceStatus
      )
  }
}

function detectionReason(type: FollowUpRecord["condition"]["type"]) {
  switch (type) {
    case "failure":
      return "failure_detected"
    case "overdue":
      return "overdue_detected"
    case "stale":
      return "stale_detected"
    case "unresolved":
      return "unresolved_detected"
  }
}
