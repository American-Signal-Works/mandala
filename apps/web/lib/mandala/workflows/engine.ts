import { createHash, randomBytes } from "node:crypto";
import type { WorkflowSpec } from "./schema";
import { hashWorkflowValue, workflowUuidFor } from "./hash";

export type CompanyRole = "owner" | "admin" | "approver" | "member" | "viewer" | "agent";
export type ActorType = "user" | "system_agent";
export type ValidationStatus = "pass" | "warn" | "blocked";
export type WorkflowItemStatus = "active" | "blocked" | "approved" | "rejected" | "executed" | "resolved";
export type DecisionKind = "approve" | "edit" | "reject" | "request_rework";

export type WorkflowDefinitionRecord = {
  id: string;
  companyId: string;
  workflowKey: string;
  workflowType: string;
  version: string;
  status: WorkflowSpec["status"];
  spec: WorkflowSpec;
  skillMarkdown: string;
};

export type WorkflowRunRecord = {
  id: string;
  companyId: string;
  workflowDefinitionId: string;
  workflowType: string;
  status:
    | "started"
    | "suppressed"
    | "blocked"
    | "waiting_for_approval"
    | "approved"
    | "rejected"
    | "rework_requested"
    | "executed"
    | "failed";
  input: Record<string, unknown>;
  langGraphThreadId: string | null;
  langGraphCheckpointId: string | null;
  langSmithTraceId: string | null;
  langSmithRunId: string | null;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
};

export type WorkflowEventRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
  eventKey: string;
  eventType: string;
  origin: "fixture" | "manual" | "connector" | "schedule" | "webhook";
  sourceRef: Record<string, unknown>;
  payload: Record<string, unknown>;
  freshnessState: "fresh" | "stale" | "unknown";
  validationStatus: ValidationStatus;
  validationResult: ValidationResult;
  createdAt: string;
};

export type ValidationResult = {
  status: ValidationStatus;
  reasons: string[];
  warnings: string[];
  suppressRecommendation: boolean;
};

export type WorkflowItemRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowEventId: string;
  workflowDefinitionId: string;
  itemKey: string;
  itemType: string;
  title: string;
  status: WorkflowItemStatus;
  priority: number;
  relatedRecords: Record<string, unknown>;
  resolutionState: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowContextPacketRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowItemId: string;
  sources: Array<Record<string, unknown>>;
  facts: Record<string, unknown>;
  memoryRefs: Array<Record<string, unknown>>;
  freshnessState: "fresh" | "stale" | "unknown";
  warnings: string[];
  createdAt: string;
};

export type WorkflowRecommendationRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowItemId: string;
  contextPacketId: string;
  status: "ready_for_review" | "blocked";
  rationaleSummary: string;
  warningState: ValidationStatus;
  warnings: string[];
  confidence: number;
  freshnessState: "fresh" | "stale" | "unknown";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  langSmithTraceId: string | null;
  langSmithRunId: string | null;
  createdAt: string;
};

export type WorkflowEvidenceRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowItemId: string;
  recommendationRunId: string;
  sourceRefs: Array<Record<string, unknown>>;
  assumptions: string[];
  warnings: string[];
  evidence: Array<Record<string, unknown>>;
  createdAt: string;
};

export type WorkflowActionDraftRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowItemId: string;
  recommendationRunId: string;
  evidenceSnapshotId: string;
  actionType: string;
  status: "pending_review" | "approved" | "rejected" | "rework_requested" | "executed";
  payload: WorkflowActionPayload;
  payloadHash: string;
  editPolicy: WorkflowEditPolicy;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowEditPolicy = {
  editable: boolean;
  requireReason: boolean;
  immutablePaths: string[][];
  arrayLengthPaths: string[][];
  positiveIntegerPaths: string[][];
  nonEmptyStringPaths: string[][];
};

export type WorkflowActionPayload = Record<string, unknown>;

export type WorkflowDecisionRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowItemId: string;
  actionDraftId: string;
  decision: DecisionKind;
  actorType: ActorType;
  decidedBy: string;
  reason: string | null;
  warningsAcknowledged: boolean;
  editedPayload: WorkflowActionPayload | null;
  createdAt: string;
};

export type WorkflowExecutionTokenRecord = {
  id: string;
  companyId: string;
  actionDraftId: string;
  actionType: string;
  tokenHash: string;
  payloadHash: string;
  expiresAt: string;
  consumedAt: string | null;
  createdBy: string;
  createdAt: string;
};

export type WorkflowActionAttemptRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowItemId: string;
  actionDraftId: string;
  decisionId: string;
  executionTokenId: string;
  idempotencyKey: string;
  actionType: string;
  mode: "mock";
  status: "succeeded" | "failed";
  requestPayload: WorkflowActionPayload;
  resultPayload: Record<string, unknown>;
  mockExternalId: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type WorkflowAuditEventRecord = {
  id: string;
  companyId: string;
  actorType: ActorType;
  actorId: string | null;
  workflowRunId: string;
  workflowItemId: string | null;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
  trace: {
    langGraphThreadId: string | null;
    langGraphCheckpointId: string | null;
    langSmithTraceId: string | null;
    langSmithRunId: string | null;
  };
  createdAt: string;
};

export type WorkflowFixtureRunResult = {
  definition: WorkflowDefinitionRecord;
  run: WorkflowRunRecord;
  event: WorkflowEventRecord;
  item: WorkflowItemRecord | null;
  contextPacket: WorkflowContextPacketRecord | null;
  recommendation: WorkflowRecommendationRecord | null;
  evidence: WorkflowEvidenceRecord | null;
  draft: WorkflowActionDraftRecord | null;
  auditEvents: WorkflowAuditEventRecord[];
};

export type DecisionResult = {
  decision: WorkflowDecisionRecord;
  item: WorkflowItemRecord;
  draft: WorkflowActionDraftRecord;
  executionToken: {
    token: WorkflowExecutionTokenRecord;
    rawToken: string;
  } | null;
  auditEvent: WorkflowAuditEventRecord;
};

export type MockExecutionResult = {
  attempt: WorkflowActionAttemptRecord;
  item: WorkflowItemRecord;
  draft: WorkflowActionDraftRecord;
  auditEvent: WorkflowAuditEventRecord | null;
  duplicate: boolean;
};

export class WorkflowMemoryStore {
  definitions: WorkflowDefinitionRecord[] = [];
  runs: WorkflowRunRecord[] = [];
  events: WorkflowEventRecord[] = [];
  items: WorkflowItemRecord[] = [];
  contextPackets: WorkflowContextPacketRecord[] = [];
  recommendations: WorkflowRecommendationRecord[] = [];
  evidenceSnapshots: WorkflowEvidenceRecord[] = [];
  drafts: WorkflowActionDraftRecord[] = [];
  decisions: WorkflowDecisionRecord[] = [];
  executionTokens: WorkflowExecutionTokenRecord[] = [];
  actionAttempts: WorkflowActionAttemptRecord[] = [];
  auditEvents: WorkflowAuditEventRecord[] = [];

  findActiveItem(itemKey: string, companyId: string): WorkflowItemRecord | null {
    return (
      this.items.find(
        (item) =>
          item.companyId === companyId &&
          item.itemKey === itemKey &&
          (item.status === "active" || item.status === "blocked" || item.status === "approved"),
      ) ?? null
    );
  }

  latestDraftForItem(itemId: string): WorkflowActionDraftRecord | null {
    return findLast(this.drafts, (draft) => draft.workflowItemId === itemId);
  }
}

export function recordWorkflowDecision(input: {
  store: WorkflowMemoryStore;
  companyId: string;
  actionDraftId: string;
  decision: DecisionKind;
  actorType: ActorType;
  actorId: string;
  actorRole: CompanyRole;
  reason?: string;
  warningsAcknowledged?: boolean;
  editedPayload?: WorkflowActionPayload;
  now?: Date;
}): DecisionResult {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const draft = input.store.drafts.find((candidate) => candidate.id === input.actionDraftId && candidate.companyId === input.companyId);
  if (!draft) throw new Error("Action draft not found.");
  if (draft.status !== "pending_review") throw new Error("Action draft is not pending review.");
  if (input.decision === "edit" && !input.editedPayload) throw new Error("Edit decisions require an edited payload.");
  if (input.decision === "edit" && !draft.editPolicy.editable) throw new Error("Action draft cannot be edited.");
  if (input.decision === "edit" && draft.editPolicy.requireReason && !input.reason?.trim()) {
    throw new Error("Edit decisions require a reason.");
  }
  if (input.decision !== "edit" && input.editedPayload) throw new Error("Edited payload is only allowed for edit decisions.");

  const item = input.store.items.find((candidate) => candidate.id === draft.workflowItemId && candidate.companyId === input.companyId);
  if (!item) throw new Error("Workflow item not found.");

  const run = input.store.runs.find((candidate) => candidate.id === draft.workflowRunId && candidate.companyId === input.companyId);
  if (!run) throw new Error("Workflow run not found.");

  const recommendation = input.store.recommendations.find(
    (candidate) => candidate.id === draft.recommendationRunId && candidate.companyId === input.companyId,
  );
  if (!recommendation) throw new Error("Recommendation not found.");

  if ((input.decision === "approve" || input.decision === "edit") && !canApprove(input.actorRole)) {
    throw new Error("Actor is not allowed to approve workflow actions.");
  }

  if ((input.decision === "approve" || input.decision === "edit") && input.actorType !== "user") {
    throw new Error("System agents cannot self-approve workflow actions.");
  }

  if (
    (input.decision === "approve" || input.decision === "edit") &&
    recommendation.warnings.length > 0 &&
    input.warningsAcknowledged !== true
  ) {
    throw new Error("Warnings must be acknowledged before approval.");
  }

  if (input.decision === "edit" && input.editedPayload) {
    assertEditedPayloadMatchesPolicy(draft.payload, input.editedPayload, draft.editPolicy);
  }
  const payload = input.decision === "edit" && input.editedPayload ? input.editedPayload : draft.payload;
  const updatedDraft: WorkflowActionDraftRecord = {
    ...draft,
    status:
      input.decision === "approve" || input.decision === "edit"
        ? "approved"
        : input.decision === "reject"
          ? "rejected"
          : "rework_requested",
    payload,
    payloadHash: hashWorkflowValue(payload),
    updatedAt: createdAt,
  };
  replaceById(input.store.drafts, updatedDraft);

  const updatedItem: WorkflowItemRecord = {
    ...item,
    status:
      input.decision === "approve" || input.decision === "edit"
        ? "approved"
        : input.decision === "reject"
          ? "rejected"
          : "active",
    resolutionState: {
      ...item.resolutionState,
      lastDecision: input.decision,
      reason: input.reason ?? null,
      warningsAcknowledged: input.warningsAcknowledged === true,
    },
    updatedAt: createdAt,
  };
  replaceById(input.store.items, updatedItem);

  run.status =
    input.decision === "approve" || input.decision === "edit"
      ? "approved"
      : input.decision === "reject"
        ? "rejected"
        : "rework_requested";
  if (input.decision === "reject") run.completedAt = createdAt;

  const decision: WorkflowDecisionRecord = {
    id: idFor("decision", input.companyId, input.actionDraftId, input.decision, String(input.store.decisions.length + 1)),
    companyId: input.companyId,
    workflowRunId: draft.workflowRunId,
    workflowItemId: draft.workflowItemId,
    actionDraftId: draft.id,
    decision: input.decision,
    actorType: input.actorType,
    decidedBy: input.actorId,
    reason: input.reason ?? null,
    warningsAcknowledged: input.warningsAcknowledged === true,
    editedPayload: input.decision === "edit" ? payload : null,
    createdAt,
  };
  input.store.decisions.push(decision);

  const executionToken =
    input.decision === "approve" || input.decision === "edit"
      ? issueExecutionToken(input.store, input.companyId, updatedDraft, input.actorId, now)
      : null;

  const auditEvent = createAuditEvent(input.store, {
    companyId: input.companyId,
    actorType: input.actorType,
    actorId: input.actorId,
    run,
    item: updatedItem,
    eventType: "decision_recorded",
    summary: `Decision recorded: ${input.decision}.`,
    payload: {
      decisionId: decision.id,
      actionDraftId: draft.id,
      warningsAcknowledged: decision.warningsAcknowledged,
    },
    createdAt,
  });

  return { decision, item: updatedItem, draft: updatedDraft, executionToken, auditEvent };
}

export function executeMockAction(input: {
  store: WorkflowMemoryStore;
  companyId: string;
  actionDraftId: string;
  rawToken: string;
  idempotencyKey: string;
  actorUserId: string;
  payload: WorkflowActionPayload;
  now?: Date;
}): MockExecutionResult {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const existingAttempt = input.store.actionAttempts.find(
    (attempt) => attempt.companyId === input.companyId && attempt.idempotencyKey === input.idempotencyKey,
  );
  if (existingAttempt) {
    if (
      existingAttempt.actionDraftId !== input.actionDraftId ||
      hashWorkflowValue(existingAttempt.requestPayload) !== hashWorkflowValue(input.payload)
    ) {
      throw new Error("Idempotency key was already used for a different request.");
    }
    const existingItem = mustFind(input.store.items, existingAttempt.workflowItemId);
    const existingDraft = mustFind(input.store.drafts, existingAttempt.actionDraftId);
    const existingRun = mustFind(input.store.runs, existingAttempt.workflowRunId);
    const auditEvent = createAuditEvent(input.store, {
      companyId: input.companyId,
      actorType: "user",
      actorId: input.actorUserId,
      run: existingRun,
      item: existingItem,
      eventType: "mock_action_retry_suppressed",
      summary: "Idempotent mock action retry returned the existing outcome.",
      payload: {
        actionAttemptId: existingAttempt.id,
        idempotencyKey: input.idempotencyKey,
      },
      createdAt,
    });
    return { attempt: existingAttempt, item: existingItem, draft: existingDraft, auditEvent, duplicate: true };
  }

  const draft = input.store.drafts.find((candidate) => candidate.id === input.actionDraftId && candidate.companyId === input.companyId);
  if (!draft) throw new Error("Action draft not found.");
  if (draft.status !== "approved") throw new Error("Action draft is not approved.");

  const tokenHash = hashExecutionToken(input.rawToken);
  const token = input.store.executionTokens.find(
    (candidate) =>
      candidate.actionDraftId === draft.id &&
      candidate.companyId === input.companyId &&
      candidate.actionType === draft.actionType &&
      candidate.tokenHash === tokenHash,
  );
  if (!token) throw new Error("Execution token not found.");
  if (token.consumedAt) throw new Error("Execution token has already been consumed.");
  if (new Date(token.expiresAt).getTime() <= now.getTime()) throw new Error("Execution token has expired.");

  const payloadHash = hashWorkflowValue(input.payload);
  if (payloadHash !== token.payloadHash || payloadHash !== draft.payloadHash) {
    throw new Error("Execution payload does not match the approved draft.");
  }

  const item = mustFind(input.store.items, draft.workflowItemId);
  const run = mustFind(input.store.runs, draft.workflowRunId);
  const decision = findLast(
    input.store.decisions,
    (candidate) => candidate.actionDraftId === draft.id && candidate.companyId === input.companyId,
  );
  if (!decision) throw new Error("Approved decision not found.");

  token.consumedAt = createdAt;
  const completedAt = createdAt;
  const mockExternalId = `mock_action_${hashWorkflowValue([input.companyId, draft.id, input.idempotencyKey]).slice(0, 16)}`;
  const attempt: WorkflowActionAttemptRecord = {
    id: idFor("attempt", input.companyId, draft.id, input.idempotencyKey),
    companyId: input.companyId,
    workflowRunId: draft.workflowRunId,
    workflowItemId: draft.workflowItemId,
    actionDraftId: draft.id,
    decisionId: decision.id,
    executionTokenId: token.id,
    idempotencyKey: input.idempotencyKey,
    actionType: draft.actionType,
    mode: "mock",
    status: "succeeded",
    requestPayload: input.payload,
    resultPayload: {
      mockExternalId,
      committed: false,
      mode: "mock",
    },
    mockExternalId,
    errorMessage: null,
    createdAt,
    completedAt,
  };
  input.store.actionAttempts.push(attempt);

  const updatedDraft: WorkflowActionDraftRecord = {
    ...draft,
    status: "executed",
    updatedAt: completedAt,
  };
  replaceById(input.store.drafts, updatedDraft);

  const updatedItem: WorkflowItemRecord = {
    ...item,
    status: "executed",
    resolutionState: {
      ...item.resolutionState,
      mockExternalId,
    },
    updatedAt: completedAt,
  };
  replaceById(input.store.items, updatedItem);

  run.status = "executed";
  run.completedAt = completedAt;

  const auditEvent = createAuditEvent(input.store, {
    companyId: input.companyId,
    actorType: "user",
    actorId: input.actorUserId,
    run,
    item: updatedItem,
    eventType: "mock_action_executed",
    summary: `Mock action executed: ${mockExternalId}.`,
    payload: {
      actionAttemptId: attempt.id,
      mockExternalId,
      idempotencyKey: input.idempotencyKey,
    },
    createdAt,
  });

  return { attempt, item: updatedItem, draft: updatedDraft, auditEvent, duplicate: false };
}

function issueExecutionToken(
  store: WorkflowMemoryStore,
  companyId: string,
  draft: WorkflowActionDraftRecord,
  createdBy: string,
  now: Date,
): { token: WorkflowExecutionTokenRecord; rawToken: string } {
  const rawToken = randomBytes(32).toString("hex");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const token: WorkflowExecutionTokenRecord = {
    id: idFor("token", companyId, draft.id, draft.payloadHash),
    companyId,
    actionDraftId: draft.id,
    actionType: draft.actionType,
    tokenHash: hashExecutionToken(rawToken),
    payloadHash: draft.payloadHash,
    expiresAt,
    consumedAt: null,
    createdBy,
    createdAt,
  };
  store.executionTokens.push(token);
  return { token, rawToken };
}

function createAuditEvent(
  store: WorkflowMemoryStore,
  input: {
    companyId: string;
    actorType: ActorType;
    actorId: string | null;
    run: WorkflowRunRecord;
    item: WorkflowItemRecord | null;
    eventType: string;
    summary: string;
    payload: Record<string, unknown>;
    createdAt: string;
  },
): WorkflowAuditEventRecord {
  const event: WorkflowAuditEventRecord = {
    id: idFor("audit", input.companyId, input.run.id, input.eventType, String(store.auditEvents.length + 1)),
    companyId: input.companyId,
    actorType: input.actorType,
    actorId: input.actorId,
    workflowRunId: input.run.id,
    workflowItemId: input.item?.id ?? null,
    eventType: input.eventType,
    summary: input.summary,
    payload: input.payload,
    trace: {
      langGraphThreadId: input.run.langGraphThreadId,
      langGraphCheckpointId: input.run.langGraphCheckpointId,
      langSmithTraceId: input.run.langSmithTraceId,
      langSmithRunId: input.run.langSmithRunId,
    },
    createdAt: input.createdAt,
  };
  store.auditEvents.push(event);
  return event;
}

function canApprove(role: CompanyRole): boolean {
  return role === "owner" || role === "admin" || role === "approver";
}

function assertEditedPayloadMatchesPolicy(
  original: WorkflowActionPayload,
  edited: WorkflowActionPayload,
  policy: WorkflowEditPolicy,
): void {
  const originalKeys = Object.keys(original).sort();
  const editedKeys = Object.keys(edited).sort();
  if (hashWorkflowValue(originalKeys) !== hashWorkflowValue(editedKeys)) {
    throw new Error("Edited payload shape changed.");
  }

  for (const path of policy.immutablePaths) {
    if (hashWorkflowValue(valueAtPath(original, path)) !== hashWorkflowValue(valueAtPath(edited, path))) {
      throw new Error("Edited payload changed an immutable value.");
    }
  }

  for (const path of policy.arrayLengthPaths) {
    const originalValue = valueAtPath(original, path);
    const editedValue = valueAtPath(edited, path);
    if (!Array.isArray(originalValue) || !Array.isArray(editedValue) || originalValue.length !== editedValue.length) {
      throw new Error("Edited payload shape changed.");
    }
  }

  for (const path of policy.positiveIntegerPaths) {
    const value = valueAtPath(edited, path);
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new Error("Edited payload contains an invalid positive integer.");
    }
  }

  for (const path of policy.nonEmptyStringPaths) {
    const value = valueAtPath(edited, path);
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Edited payload contains an invalid string.");
    }
  }
}

function valueAtPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, value);
}

function replaceById<T extends { id: string }>(records: T[], replacement: T): void {
  const index = records.findIndex((record) => record.id === replacement.id);
  if (index === -1) throw new Error(`Record not found: ${replacement.id}`);
  records[index] = replacement;
}

function findLast<T>(records: T[], predicate: (record: T) => boolean): T | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (predicate(record)) return record;
  }
  return null;
}

function mustFind<T extends { id: string }>(records: T[], id: string): T {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new Error(`Record not found: ${id}`);
  return record;
}

function idFor(prefix: string, ...parts: string[]): string {
  return workflowUuidFor(prefix, ...parts);
}

function hashExecutionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
