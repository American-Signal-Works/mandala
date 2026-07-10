import {
  companiesResponseSchema,
  controlRequestCreateRequestSchema,
  controlRequestCreateResponseSchema,
  controlRequestTransitionRequestSchema,
  controlRequestTransitionResponseSchema,
  controlParseRequestSchema,
  controlParseResponseSchema,
  decisionRequestSchema,
  decisionResponseSchema,
  executionRequestSchema,
  executionResponseSchema,
  executionTokenRequestSchema,
  executionTokenResponseSchema,
  fixtureRunRequestSchema,
  fixtureRunResponseSchema,
  workItemDetailResponseSchema,
  workItemListResponseSchema,
  type CompanySummary,
  type ControlRequestCreateRequest,
  type ControlRequestTransitionRequest,
  type ControlParseData,
  type ControlParseRequest,
  type DecisionData,
  type DecisionRequest,
  type ExecutionData,
  type ExecutionRequest,
  type ExecutionTokenData,
  type ExecutionTokenRequest,
  type FixtureRunData,
  type FixtureRunRequest,
  type WorkItemDetail,
  type WorkItemSummary,
} from "@workspace/control-plane"
import type { z } from "zod"
import type { SessionAccess } from "./auth.js"
import { CliError } from "./errors.js"

export interface ControlApi {
  listCompanies(): Promise<{ companies: CompanySummary[] }>
  listWorkItems(
    companyId: string,
    status?: string
  ): Promise<{ items: WorkItemSummary[] }>
  getWorkItem(companyId: string, itemId: string): Promise<WorkItemDetail>
  runFixture(request: FixtureRunRequest): Promise<FixtureRunData>
  recordDecision(request: DecisionRequest): Promise<DecisionData>
  issueExecutionToken(
    request: ExecutionTokenRequest
  ): Promise<ExecutionTokenData>
  execute(request: ExecutionRequest): Promise<ExecutionData>
  parseControlIntent(request: ControlParseRequest): Promise<ControlParseData>
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

  listCompanies(): Promise<{ companies: CompanySummary[] }> {
    return this.request("/api/mandala/companies", companiesResponseSchema)
  }

  listWorkItems(
    companyId: string,
    status?: string
  ): Promise<{ items: WorkItemSummary[] }> {
    const query = new URLSearchParams({ companyId })
    if (status) query.set("status", status)
    return this.request(
      `/api/mandala/workflows/items?${query.toString()}`,
      workItemListResponseSchema
    )
  }

  getWorkItem(companyId: string, itemId: string): Promise<WorkItemDetail> {
    const query = new URLSearchParams({ companyId })
    return this.request(
      `/api/mandala/workflows/items/${encodeURIComponent(itemId)}?${query.toString()}`,
      workItemDetailResponseSchema
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

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: "GET" | "POST"; body?: unknown } = {}
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
    options: { method?: "GET" | "POST"; body?: unknown },
    forceRefresh: boolean
  ): Promise<Response> {
    const accessToken = await this.session.getAccessToken(forceRefresh)
    try {
      return await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      })
    } catch {
      throw new CliError(
        "network_error",
        "The Mandala API could not be reached."
      )
    }
  }
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
