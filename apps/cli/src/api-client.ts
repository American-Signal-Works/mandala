import {
  agentActionRequestSchema,
  agentActionResponseSchema,
  agentInstallRequestSchema,
  agentInstallResponseSchema,
  agentListResponseSchema,
  agentTestRunRequestSchema,
  agentTestRunResponseSchema,
  agentValidateRequestSchema,
  agentValidateResponseSchema,
  companiesResponseSchema,
  cliSessionCompanySelectionRequestSchema,
  cliSessionCompanySelectionResponseSchema,
  controlRequestCreateRequestSchema,
  controlRequestCreateResponseSchema,
  controlRequestTransitionRequestSchema,
  controlRequestTransitionResponseSchema,
  controlParseRequestSchema,
  controlParseResponseSchema,
  contextualChatRequestSchema,
  contextualChatResponseSchema,
  contextualChatStreamEventSchema,
  contextWorkspaceConfigurationRequestSchema,
  contextWorkspaceStatusSchema,
  decisionRequestSchema,
  decisionResponseSchema,
  executionRequestSchema,
  executionResponseSchema,
  executionTokenRequestSchema,
  executionTokenResponseSchema,
  fixtureRunRequestSchema,
  fixtureRunResponseSchema,
  sandboxSessionRequestSchema,
  sandboxSessionResponseSchema,
  workspaceSandboxRunRequestSchema,
  workspaceSandboxRunResponseSchema,
  workItemDetailResponseSchema,
  workItemQueueResponseSchema,
  workItemQuestionRequestSchema,
  workItemQuestionResponseSchema,
  workItemReviewResponseSchema,
  type AgentActionRequest,
  type AgentInstallRequest,
  type AgentSummary,
  type AgentTestRunRequest,
  type AgentValidateRequest,
  type AgentValidateResponse,
  type CompanySummary,
  type ControlRequestCreateRequest,
  type ControlRequestTransitionRequest,
  type ControlParseData,
  type ControlParseRequest,
  type ContextualChatRequest,
  type ContextualChatResponse,
  type ContextualChatStreamEvent,
  type ContextWorkspaceConfigurationRequest,
  type ContextWorkspaceStatus,
  type DecisionData,
  type DecisionRequest,
  type ExecutionData,
  type ExecutionRequest,
  type ExecutionTokenData,
  type ExecutionTokenRequest,
  type FixtureRunData,
  type FixtureRunRequest,
  type SandboxSessionRequest,
  type SandboxSessionResponse,
  type WorkspaceSandboxRunRequest,
  type WorkspaceSandboxRunResponse,
  type WorkItemDetail,
  type WorkItemQueueData,
  type WorkItemQuestionData,
  type WorkItemQuestionRequest,
  type WorkItemReviewData,
} from "@workspace/control-plane"
import type { z } from "zod"
import type { SessionAccess } from "./auth.js"
import { CliError } from "./errors.js"

type AgentActionData = z.infer<typeof agentActionResponseSchema>
type AgentInstallData = z.infer<typeof agentInstallResponseSchema>
type AgentTestRunData = z.infer<typeof agentTestRunResponseSchema>

export interface ControlApi {
  getContextWorkspaceStatus(companyId: string): Promise<ContextWorkspaceStatus>
  setContextWorkspaceConfiguration(
    request: ContextWorkspaceConfigurationRequest
  ): Promise<ContextWorkspaceStatus>
  runWorkspaceSandbox(
    request: WorkspaceSandboxRunRequest
  ): Promise<WorkspaceSandboxRunResponse>
  createSandboxSession(
    request: SandboxSessionRequest
  ): Promise<SandboxSessionResponse>
  listAgents(companyId: string): Promise<{ agents: AgentSummary[] }>
  installAgent(request: AgentInstallRequest): Promise<AgentInstallData>
  validateAgent(request: AgentValidateRequest): Promise<AgentValidateResponse>
  testAgent(
    agentId: string,
    request: AgentTestRunRequest
  ): Promise<AgentTestRunData>
  activateAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData>
  deactivateAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData>
  pauseAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData>
  resumeAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData>
  disableAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData>
  rollbackAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData>
  listCompanies(): Promise<{ companies: CompanySummary[] }>
  selectCompany(
    companyId: string
  ): Promise<{ company: Pick<CompanySummary, "id" | "name" | "role"> }>
  listWorkItems(companyId: string, status?: string): Promise<WorkItemQueueData>
  getWorkItem(companyId: string, itemId: string): Promise<WorkItemDetail>
  getWorkItemReview(
    companyId: string,
    itemId: string
  ): Promise<WorkItemReviewData>
  askWorkItem(
    itemId: string,
    request: WorkItemQuestionRequest
  ): Promise<WorkItemQuestionData>
  runFixture(request: FixtureRunRequest): Promise<FixtureRunData>
  recordDecision(request: DecisionRequest): Promise<DecisionData>
  issueExecutionToken(
    request: ExecutionTokenRequest
  ): Promise<ExecutionTokenData>
  execute(request: ExecutionRequest): Promise<ExecutionData>
  parseControlIntent(request: ControlParseRequest): Promise<ControlParseData>
  contextualChat?(
    request: ContextualChatRequest
  ): Promise<ContextualChatResponse>
  contextualChatStream?(
    request: ContextualChatRequest,
    onDelta: (cumulativeText: string) => void,
    signal?: AbortSignal
  ): Promise<ContextualChatResponse>
  recordControlRequest(
    request: ControlRequestCreateRequest
  ): Promise<{ request: Record<string, unknown> & { id: string } }>
  transitionControlRequest(
    request: ControlRequestTransitionRequest
  ): Promise<{ request: Record<string, unknown> & { id: string } }>
}

export class ApiClient implements ControlApi {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly session: SessionAccess,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
  }

  getContextWorkspaceStatus(
    companyId: string
  ): Promise<ContextWorkspaceStatus> {
    const query = new URLSearchParams({ companyId })
    return this.request(
      `/api/mandala/context/settings?${query.toString()}`,
      contextWorkspaceStatusSchema
    )
  }

  setContextWorkspaceConfiguration(
    request: ContextWorkspaceConfigurationRequest
  ): Promise<ContextWorkspaceStatus> {
    return this.request(
      "/api/mandala/context/settings",
      contextWorkspaceStatusSchema,
      {
        method: "PATCH",
        body: contextWorkspaceConfigurationRequestSchema.parse(request),
      }
    )
  }

  runWorkspaceSandbox(
    request: WorkspaceSandboxRunRequest
  ): Promise<WorkspaceSandboxRunResponse> {
    return this.request(
      "/api/mandala/sandbox/runs",
      workspaceSandboxRunResponseSchema,
      {
        method: "POST",
        body: workspaceSandboxRunRequestSchema.parse(request),
      }
    )
  }

  createSandboxSession(
    request: SandboxSessionRequest
  ): Promise<SandboxSessionResponse> {
    return this.request(
      "/api/mandala/sandbox/sessions",
      sandboxSessionResponseSchema,
      {
        method: "POST",
        body: sandboxSessionRequestSchema.parse(request),
      }
    )
  }

  listAgents(companyId: string): Promise<{ agents: AgentSummary[] }> {
    const query = new URLSearchParams({ companyId })
    return this.request(
      `/api/mandala/agents?${query.toString()}`,
      agentListResponseSchema
    )
  }

  installAgent(request: AgentInstallRequest): Promise<AgentInstallData> {
    return this.request("/api/mandala/agents", agentInstallResponseSchema, {
      method: "POST",
      body: agentInstallRequestSchema.parse(request),
    })
  }

  validateAgent(request: AgentValidateRequest): Promise<AgentValidateResponse> {
    return this.request(
      "/api/mandala/agents/validate",
      agentValidateResponseSchema,
      {
        method: "POST",
        body: agentValidateRequestSchema.parse(request),
      }
    )
  }

  testAgent(
    agentId: string,
    request: AgentTestRunRequest
  ): Promise<AgentTestRunData> {
    return this.agentActionRequest(
      agentId,
      "test-runs",
      agentTestRunResponseSchema,
      agentTestRunRequestSchema.parse(request)
    )
  }

  activateAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData> {
    return this.agentActionRequest(
      agentId,
      "activate",
      agentActionResponseSchema,
      agentActionRequestSchema.parse(request)
    )
  }

  deactivateAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData> {
    return this.agentActionRequest(
      agentId,
      "deactivate",
      agentActionResponseSchema,
      agentActionRequestSchema.parse(request)
    )
  }

  pauseAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData> {
    return this.agentActionRequest(
      agentId,
      "pause",
      agentActionResponseSchema,
      agentActionRequestSchema.parse(request)
    )
  }

  resumeAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData> {
    return this.agentActionRequest(
      agentId,
      "resume",
      agentActionResponseSchema,
      agentActionRequestSchema.parse(request)
    )
  }

  disableAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData> {
    return this.agentActionRequest(
      agentId,
      "disable",
      agentActionResponseSchema,
      agentActionRequestSchema.parse(request)
    )
  }

  rollbackAgent(
    agentId: string,
    request: AgentActionRequest
  ): Promise<AgentActionData> {
    return this.agentActionRequest(
      agentId,
      "rollback",
      agentActionResponseSchema,
      agentActionRequestSchema.parse(request)
    )
  }

  listCompanies(): Promise<{ companies: CompanySummary[] }> {
    return this.request("/api/mandala/companies", companiesResponseSchema)
  }

  selectCompany(
    companyId: string
  ): Promise<{ company: Pick<CompanySummary, "id" | "name" | "role"> }> {
    return this.request(
      "/api/mandala/cli/sessions/company",
      cliSessionCompanySelectionResponseSchema,
      {
        method: "PUT",
        body: cliSessionCompanySelectionRequestSchema.parse({ companyId }),
      }
    )
  }

  listWorkItems(
    companyId: string,
    status?: string
  ): Promise<WorkItemQueueData> {
    const query = new URLSearchParams({ companyId })
    if (status) query.set("status", status)
    return this.request(
      `/api/mandala/workflows/items?${query.toString()}`,
      workItemQueueResponseSchema
    )
  }

  getWorkItem(companyId: string, itemId: string): Promise<WorkItemDetail> {
    const query = new URLSearchParams({ companyId })
    return this.request(
      `/api/mandala/workflows/items/${encodeURIComponent(itemId)}?${query.toString()}`,
      workItemDetailResponseSchema
    )
  }

  getWorkItemReview(
    companyId: string,
    itemId: string
  ): Promise<WorkItemReviewData> {
    const query = new URLSearchParams({ companyId })
    return this.request(
      `/api/mandala/workflows/items/${encodeURIComponent(itemId)}/review?${query.toString()}`,
      workItemReviewResponseSchema
    )
  }

  askWorkItem(
    itemId: string,
    request: WorkItemQuestionRequest
  ): Promise<WorkItemQuestionData> {
    return this.request(
      `/api/mandala/workflows/items/${encodeURIComponent(itemId)}/questions`,
      workItemQuestionResponseSchema,
      {
        method: "POST",
        body: workItemQuestionRequestSchema.parse(request),
      }
    )
  }

  runFixture(request: FixtureRunRequest): Promise<FixtureRunData> {
    return this.request(
      "/api/mandala/workflows/fixtures",
      fixtureRunResponseSchema,
      {
        method: "POST",
        body: fixtureRunRequestSchema.parse(request),
      }
    )
  }

  recordDecision(request: DecisionRequest): Promise<DecisionData> {
    return this.request(
      "/api/mandala/workflows/decisions",
      decisionResponseSchema,
      {
        method: "POST",
        body: decisionRequestSchema.parse(request),
      }
    )
  }

  issueExecutionToken(
    request: ExecutionTokenRequest
  ): Promise<ExecutionTokenData> {
    return this.request(
      "/api/mandala/workflows/execution-tokens",
      executionTokenResponseSchema,
      {
        method: "POST",
        body: executionTokenRequestSchema.parse(request),
      }
    )
  }

  execute(request: ExecutionRequest): Promise<ExecutionData> {
    return this.request(
      "/api/mandala/workflows/executions",
      executionResponseSchema,
      {
        method: "POST",
        body: executionRequestSchema.parse(request),
      }
    )
  }

  parseControlIntent(request: ControlParseRequest): Promise<ControlParseData> {
    return this.request(
      "/api/mandala/control/intents/parse",
      controlParseResponseSchema,
      {
        method: "POST",
        body: controlParseRequestSchema.parse(request),
      }
    ) as Promise<ControlParseData>
  }

  contextualChat(
    request: ContextualChatRequest
  ): Promise<ContextualChatResponse> {
    return this.request(
      "/api/mandala/control/chat",
      contextualChatResponseSchema,
      {
        method: "POST",
        body: contextualChatRequestSchema.parse(request),
      }
    )
  }

  async contextualChatStream(
    request: ContextualChatRequest,
    onDelta: (cumulativeText: string) => void,
    signal?: AbortSignal
  ): Promise<ContextualChatResponse> {
    const options: RequestOptions = {
      method: "POST",
      body: contextualChatRequestSchema.parse(request),
      accept: "application/x-ndjson, application/json;q=0.9",
      signal,
    }
    let response = await this.send("/api/mandala/control/chat", options, false)
    if (response.status === 401) {
      response = await this.send("/api/mandala/control/chat", options, true)
    }
    if (!response.ok) {
      const payload = await parseResponseJson(response)
      throw responseError(response.status, payload)
    }
    const contentType = response.headers.get("content-type")?.toLowerCase()
    if (!contentType?.includes("application/x-ndjson")) {
      const payload = unwrapSuccess(await parseResponseJson(response))
      const parsed = contextualChatResponseSchema.safeParse(payload)
      if (!parsed.success) throw invalidStreamResponse()
      return parsed.data
    }
    try {
      return await readContextualChatStream(response, onDelta)
    } catch (error) {
      if (signal?.aborted || isAbortError(error))
        throw new CliError("command_cancelled", "Answer stopped.")
      throw error
    }
  }

  recordControlRequest(
    request: ControlRequestCreateRequest
  ): Promise<{ request: Record<string, unknown> & { id: string } }> {
    return this.request(
      "/api/mandala/control/requests",
      controlRequestCreateResponseSchema,
      {
        method: "POST",
        body: controlRequestCreateRequestSchema.parse(request),
      }
    )
  }

  transitionControlRequest(
    request: ControlRequestTransitionRequest
  ): Promise<{ request: Record<string, unknown> & { id: string } }> {
    return this.request(
      "/api/mandala/control/requests/transition",
      controlRequestTransitionResponseSchema,
      {
        method: "POST",
        body: controlRequestTransitionRequestSchema.parse(request),
      }
    )
  }

  private agentActionRequest<T>(
    agentId: string,
    action: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    body: unknown
  ): Promise<T> {
    return this.request(
      `/api/mandala/agents/${encodeURIComponent(agentId)}/${action}`,
      schema,
      { method: "POST", body }
    )
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: RequestOptions = {}
  ): Promise<T> {
    let response = await this.send(path, options, false)
    if (response.status === 401) response = await this.send(path, options, true)

    const payload = await parseResponseJson(response)
    if (!response.ok) throw responseError(response.status, payload)

    const unwrapped = unwrapSuccess(payload)
    const parsed = schema.safeParse(unwrapped)
    if (!parsed.success)
      throw new CliError(
        "invalid_api_response",
        "The server returned an incompatible response."
      )
    return parsed.data
  }

  private async send(
    path: string,
    options: RequestOptions,
    forceRefresh: boolean
  ): Promise<Response> {
    const accessToken = await this.session.getAccessToken(forceRefresh)
    try {
      return await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          accept: options.accept ?? "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted || isAbortError(error)) {
        throw new CliError("command_cancelled", "Answer stopped.")
      }
      if (isDefinitelyUnavailable(error)) {
        throw new CliError(
          "api_unavailable",
          "The Mandala API is not accepting connections."
        )
      }
      throw new CliError(
        "network_error",
        "The Mandala API could not be reached."
      )
    }
  }
}

type RequestOptions = {
  method?: "GET" | "PATCH" | "POST" | "PUT"
  body?: unknown
  accept?: string
  signal?: AbortSignal
}

async function readContextualChatStream(
  response: Response,
  onDelta: (cumulativeText: string) => void
): Promise<ContextualChatResponse> {
  if (!response.body) throw invalidStreamResponse()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""
  let totalBytes = 0
  let answer = ""
  let start: Extract<ContextualChatStreamEvent, { type: "start" }> | undefined
  let done = false

  const consume = (line: string) => {
    if (!line) return
    if (line.length > 10_000) throw invalidStreamResponse()
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw invalidStreamResponse()
    }
    const parsed = contextualChatStreamEventSchema.safeParse(value)
    if (!parsed.success) throw invalidStreamResponse()
    const event = parsed.data
    if (event.type === "start") {
      if (start || done) throw invalidStreamResponse()
      start = event
      return
    }
    if (!start || done) throw invalidStreamResponse()
    if (event.type === "delta") {
      answer += event.text
      if (answer.length > 5_000) throw invalidStreamResponse()
      onDelta(answer)
      return
    }
    if (event.type === "error") {
      done = true
      throw new CliError(event.error, streamErrorMessage(event.error))
    }
    if (event.answer !== answer) throw invalidStreamResponse()
    done = true
  }

  try {
    while (true) {
      const { done: readerDone, value } = await reader.read()
      if (readerDone) break
      totalBytes += value.byteLength
      if (totalBytes > 20_000) throw invalidStreamResponse()
      buffered += decoder.decode(value, { stream: true })
      let newline = buffered.indexOf("\n")
      while (newline >= 0) {
        consume(buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        newline = buffered.indexOf("\n")
      }
    }
    buffered += decoder.decode()
    if (buffered.length > 0) consume(buffered)
    if (!start || !done || !answer) throw invalidStreamResponse()
  } catch (error) {
    try {
      await reader.cancel()
    } catch {
      // Preserve the original protocol or callback failure.
    }
    throw error
  } finally {
    reader.releaseLock()
  }
  return contextualChatResponseSchema.parse({
    route: "question",
    message: answer,
    companyId: start.companyId,
    selectedItemId: start.selectedItemId,
    reviewVersion: start.reviewVersion,
    command: null,
    confirmationRequired: false,
    mutated: false,
  })
}

function invalidStreamResponse(): CliError {
  return new CliError(
    "invalid_api_response",
    "The server returned an incomplete answer stream."
  )
}

function streamErrorMessage(code: string): string {
  if (code === "sensitive_model_input")
    return "That question contains sensitive text and was not sent to the model."
  if (code === "unsafe_model_output")
    return "Mandala stopped an unsafe model response before displaying it."
  return "Mandala could not answer that item question right now."
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message === "This operation was aborted")
  )
}

function isDefinitelyUnavailable(error: unknown): boolean {
  const unavailableCodes = new Set([
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
  ])
  let current = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isRecord(current)) return false
    if (typeof current.code === "string" && unavailableCodes.has(current.code))
      return true
    current = current.cause
  }
  return false
}

async function parseResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    if (response.ok)
      throw new CliError(
        "invalid_api_response",
        "The server returned a non-JSON response."
      )
    return null
  }
}

function unwrapSuccess(payload: unknown): unknown {
  if (isRecord(payload) && payload.ok === true && "data" in payload)
    return payload.data
  return payload
}

function responseError(status: number, payload: unknown): CliError {
  const code =
    isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : isRecord(payload) &&
          isRecord(payload.error) &&
          typeof payload.error.code === "string"
        ? payload.error.code
        : status === 401
          ? "unauthorized"
          : status === 403
            ? "forbidden"
            : "api_request_failed"
  return new CliError(code, `The Mandala API request failed (${status}).`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
