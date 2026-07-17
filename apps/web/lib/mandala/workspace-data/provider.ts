import type {
  WorkspaceCapabilityMappingSpec,
  WorkspaceMappingExpression,
  WorkspaceMappingFilter,
} from "@workspace/control-plane"
import { workspaceCapabilityMappingSpecSchema } from "@workspace/control-plane"
import type {
  CompiledAgentManifest,
  CompiledCapabilityBinding,
} from "../skills/compiler"
import type { RuntimeCapabilityProvider } from "../runtime/graph"
import type { RuntimeSourceRef, RuntimeState } from "../runtime/state"

const maximumExpressionDepth = 16
const maximumExpressionOperations = 500
const unsafeSegments = new Set(["__proto__", "constructor", "prototype"])

export type WorkspaceExternalRecord = {
  id: string
  companyId: string
  sourceId: string
  sourceKey: string
  recordType: string
  externalId: string
  payload: Record<string, unknown>
  pulledAt: string
}

export type WorkspaceMappingBinding = {
  mappingVersionId: string
  mappingKey: string
  specHash: string
  catalogDigest: string
  spec: WorkspaceCapabilityMappingSpec
}

export type WorkspaceDataStore = {
  resolveMapping(input: {
    companyId: string
    requirementKey: string
    capabilityKey: string
    capabilityVersion: string
  }): Promise<WorkspaceMappingBinding>
  loadRecords(input: {
    companyId: string
    sourceKey?: string
    recordType: string
    limit: number
  }): Promise<WorkspaceExternalRecord[]>
}

export type WorkspaceSignal = {
  id: string
  mappingVersionId: string
  entityKey: string
  entityValue: string
  detectedAt: string
  evidence: Record<string, unknown>
}

export type WorkspaceProjection = {
  binding: WorkspaceMappingBinding
  records: Record<string, unknown>[]
  sourceRefs: RuntimeSourceRef[]
  warnings: string[]
}

export class WorkspaceDataProviderError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "WorkspaceDataProviderError"
  }
}

export class WorkspaceDatasetProvider implements RuntimeCapabilityProvider {
  private prepared: {
    projections: Map<string, WorkspaceProjection>
    signal: WorkspaceSignal
  } | null = null

  constructor(
    private readonly store: WorkspaceDataStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async prepare(input: {
    companyId: string
    bindings: readonly CompiledCapabilityBinding[]
  }): Promise<{ signal: WorkspaceSignal; projections: WorkspaceProjection[] }> {
    const readBindings = input.bindings.filter(
      ({ access }) => access === "read"
    )
    const projections = await Promise.all(
      readBindings.map(async (binding) => {
        const mapping = await this.store.resolveMapping({
          companyId: input.companyId,
          requirementKey: binding.alias,
          capabilityKey: binding.id,
          capabilityVersion: binding.version,
        })
        return [
          binding.alias,
          await this.project(input.companyId, binding.alias, mapping),
        ] as const
      })
    )
    const projectionMap = new Map(projections)
    const signal = detectWorkspaceSignal(
      [...projectionMap.values()],
      this.now().toISOString()
    )
    if (!signal) {
      throw new WorkspaceDataProviderError(
        "qualifying_signal_not_found",
        "No cataloged workspace record matched an installed skill signal."
      )
    }
    this.prepared = { projections: projectionMap, signal }
    return { signal, projections: [...projectionMap.values()] }
  }

  async load(input: {
    state: RuntimeState
    manifest: CompiledAgentManifest
    bindings: readonly CompiledCapabilityBinding[]
    allowedTools: readonly string[]
  }): Promise<{
    data: Record<string, unknown>
    sourceRefs: RuntimeSourceRef[]
    warnings?: string[]
  }> {
    if (!this.prepared) {
      await this.prepare({
        companyId: input.state.companyId,
        bindings: input.bindings,
      })
    }
    const prepared = this.prepared!
    const data: Record<string, unknown> = {}
    const sourceRefs: RuntimeSourceRef[] = []
    const warnings: string[] = []
    for (const binding of input.bindings.filter(
      ({ access }) => access === "read"
    )) {
      if (!input.allowedTools.includes(binding.toolName)) {
        throw new WorkspaceDataProviderError(
          "tool_not_allowed",
          `The compiled graph did not allow ${binding.toolName}.`
        )
      }
      const projection = prepared.projections.get(binding.alias)
      if (!projection) {
        throw new WorkspaceDataProviderError(
          "mapping_not_prepared",
          `No validated mapping was prepared for ${binding.alias}.`
        )
      }
      const entityKey = projection.binding.spec.output.entityKey
      const selected = projection.records.find(
        (record) => String(record[entityKey]) === prepared.signal.entityValue
      )
      data[binding.alias] = {
        ...(selected ?? {}),
        [projection.binding.spec.output.collection]: projection.records,
      }
      sourceRefs.push(...projection.sourceRefs)
      warnings.push(...projection.warnings)
    }
    return { data, sourceRefs, warnings }
  }

  private async project(
    companyId: string,
    requirementAlias: string,
    binding: WorkspaceMappingBinding
  ): Promise<WorkspaceProjection> {
    const spec = workspaceCapabilityMappingSpecSchema.parse(binding.spec)
    const datasets = new Map<string, Map<string, NormalizedRow[]>>()
    const sourceRefs: RuntimeSourceRef[] = []
    let inputRows = 0

    for (const dataset of spec.datasets) {
      const perDatasetLimit = Math.max(
        1,
        Math.floor(spec.bounds.maximumInputRows / spec.datasets.length)
      )
      const remaining = Math.min(
        perDatasetLimit,
        spec.bounds.maximumInputRows - inputRows
      )
      if (remaining <= 0) {
        throw new WorkspaceDataProviderError(
          "input_row_limit_exceeded",
          "The workspace mapping exceeded its configured input row limit."
        )
      }
      const records = await this.store.loadRecords({
        companyId,
        sourceKey: dataset.sourceKey,
        recordType: dataset.recordType,
        limit: remaining,
      })
      if (dataset.required && records.length === 0) {
        throw new WorkspaceDataProviderError(
          "required_dataset_empty",
          `Required dataset ${dataset.alias} returned no rows.`
        )
      }
      const normalized = records
        .flatMap((record) =>
          normalizeRecord(record, dataset.rowsPath, dataset.entityPath)
        )
        .slice(0, remaining)
      inputRows += normalized.length
      datasets.set(dataset.alias, groupRowsByEntity(normalized))
      for (const record of records.slice(0, 100)) {
        sourceRefs.push({
          capabilityAlias: requirementAlias,
          connectorId: "mandala.workspace-data",
          observedAt: record.pulledAt,
          reference: {
            mappingVersionId: binding.mappingVersionId,
            catalogDigest: binding.catalogDigest,
            sourceKey: record.sourceKey,
            recordType: record.recordType,
            externalId: record.externalId,
          },
        })
      }
    }

    const entities = unique(
      [...datasets.values()].flatMap((rows) => [...rows.keys()])
    )
    const records: Record<string, unknown>[] = []
    const warnings: string[] = []
    for (const entity of entities) {
      if (records.length >= spec.bounds.maximumOutputRows) break
      const output: Record<string, unknown> = {}
      let valid = true
      for (const field of spec.output.fields) {
        const value = evaluateExpression(
          field.expression,
          datasets,
          entity,
          this.now(),
          {
            operations: 0,
          }
        )
        if (value === undefined || value === null) {
          if (field.required) {
            valid = false
            warnings.push(
              `Entity ${entity} is missing required field ${field.name}.`
            )
          }
          continue
        }
        output[field.name] = value
      }
      if (valid) records.push(output)
    }

    const byteCount = Buffer.byteLength(JSON.stringify(records), "utf8")
    if (byteCount > spec.bounds.maximumOutputBytes) {
      throw new WorkspaceDataProviderError(
        "output_byte_limit_exceeded",
        "The mapped workspace projection exceeded its configured byte limit."
      )
    }
    return { binding: { ...binding, spec }, records, sourceRefs, warnings }
  }
}

export function detectWorkspaceSignal(
  projections: readonly WorkspaceProjection[],
  detectedAt: string
): WorkspaceSignal | null {
  for (const projection of projections) {
    const signal = projection.binding.spec.signal
    if (!signal) continue
    const entityKey = projection.binding.spec.output.entityKey
    for (const record of projection.records) {
      if (
        !signal.all.every((condition) =>
          evaluateSignalCondition(condition, record)
        )
      ) {
        continue
      }
      const entityValue = record[entityKey]
      if (typeof entityValue !== "string" && typeof entityValue !== "number")
        continue
      const complete = projections.every((candidateProjection) => {
        const candidateEntityKey =
          candidateProjection.binding.spec.output.entityKey
        return candidateProjection.records.some(
          (candidate) =>
            String(candidate[candidateEntityKey]) === String(entityValue)
        )
      })
      if (!complete) continue
      return {
        id: signal.id,
        mappingVersionId: projection.binding.mappingVersionId,
        entityKey,
        entityValue: String(entityValue),
        detectedAt,
        evidence: Object.fromEntries(
          signal.all.map(({ left }) => [left, record[left]])
        ),
      }
    }
  }
  return null
}

type NormalizedRow = {
  entity: string
  value: Record<string, unknown>
}

function normalizeRecord(
  record: WorkspaceExternalRecord,
  rowsPath: string | undefined,
  entityPath: string
): NormalizedRow[] {
  const metadata = {
    $externalId: record.externalId,
    $pulledAt: record.pulledAt,
    $sourceKey: record.sourceKey,
    $recordType: record.recordType,
  }
  if (!rowsPath) {
    const value = { ...record.payload, ...metadata }
    const entity = pointer(value, entityPath)
    return scalarEntity(entity) ? [{ entity: String(entity), value }] : []
  }
  const rows = pointer(record.payload, rowsPath)
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    if (!isRecord(row)) return []
    const value = { ...row, $parent: record.payload, ...metadata }
    const entity = pointer(value, entityPath)
    return scalarEntity(entity) ? [{ entity: String(entity), value }] : []
  })
}

function evaluateExpression(
  expression: WorkspaceMappingExpression,
  datasets: ReadonlyMap<string, ReadonlyMap<string, NormalizedRow[]>>,
  entity: string,
  now: Date,
  budget: { operations: number },
  depth = 0
): unknown {
  if (
    depth > maximumExpressionDepth ||
    ++budget.operations > maximumExpressionOperations
  ) {
    throw new WorkspaceDataProviderError(
      "mapping_expression_limit_exceeded",
      "The declarative mapping exceeded its expression budget."
    )
  }
  if (expression.op === "literal") return expression.value
  if ("dataset" in expression) {
    const rows = (datasets.get(expression.dataset)?.get(entity) ?? []).filter(
      (row) =>
        (expression.where ?? []).every((filter) =>
          evaluateFilter(filter, row.value, now)
        )
    )
    if (expression.op === "count") return rows.length
    if (expression.op === "age_hours") {
      const dates = rows
        .map(({ value }) => pointer(value, expression.path ?? "/$pulledAt"))
        .map(asDate)
        .filter((value): value is Date => value !== null)
      if (dates.length === 0) return undefined
      const freshest = Math.max(...dates.map((value) => value.getTime()))
      return Math.max(0, (now.getTime() - freshest) / 3_600_000)
    }
    const values = rows
      .map(({ value }) => pointer(value, expression.path ?? ""))
      .filter((value) => value !== undefined && value !== null)
    if (expression.op === "first") return values[0]
    const numbers = values
      .map(asFiniteNumber)
      .filter((value): value is number => value !== null)
    if (expression.op === "sum")
      return numbers.reduce((sum, value) => sum + value, 0)
    if (numbers.length === 0) return undefined
    return expression.op === "min" ? Math.min(...numbers) : Math.max(...numbers)
  }
  const rawValues = expression.operands.map((operand) =>
    evaluateExpression(operand, datasets, entity, now, budget, depth + 1)
  )
  if (expression.op === "coalesce") {
    return rawValues.find(
      (value) => value !== undefined && value !== null && value !== ""
    )
  }
  const values = rawValues.map(asFiniteNumber)
  if (values.some((value) => value === null)) return undefined
  const numbers = values as number[]
  switch (expression.op) {
    case "add":
      return numbers.reduce((total, value) => total + value, 0)
    case "subtract":
      return numbers
        .slice(1)
        .reduce((total, value) => total - value, numbers[0]!)
    case "multiply":
      return numbers.reduce((total, value) => total * value, 1)
    case "divide":
      return numbers.slice(1).reduce((total, value) => {
        if (value === 0) {
          throw new WorkspaceDataProviderError(
            "division_by_zero",
            "A mapping attempted division by zero."
          )
        }
        return total / value
      }, numbers[0]!)
    case "max_of":
      return Math.max(...numbers)
    case "min_of":
      return Math.min(...numbers)
  }
}

function evaluateFilter(
  filter: WorkspaceMappingFilter,
  row: Record<string, unknown>,
  now: Date
): boolean {
  const left = pointer(row, filter.path)
  if (filter.operator === "non_empty")
    return left !== null && left !== undefined && left !== ""
  if (
    filter.operator === "within_days" ||
    filter.operator === "not_within_days"
  ) {
    const date = asDate(left)
    const days = asFiniteNumber(filter.value)
    if (!date || days === null || days < 0) return false
    const within = now.getTime() - date.getTime() <= days * 86_400_000
    return filter.operator === "within_days" ? within : !within
  }
  return compare(left, filter.value, filter.operator)
}

function evaluateSignalCondition(
  condition: NonNullable<
    WorkspaceCapabilityMappingSpec["signal"]
  >["all"][number],
  record: Record<string, unknown>
): boolean {
  const right =
    "field" in condition.right
      ? record[condition.right.field]
      : condition.right.value
  return compare(record[condition.left], right, condition.operator)
}

function compare(left: unknown, right: unknown, operator: string): boolean {
  if (operator === "eq") return left === right
  if (operator === "neq") return left !== right
  if (typeof left !== "number" || typeof right !== "number") return false
  if (operator === "gt") return left > right
  if (operator === "gte") return left >= right
  if (operator === "lt") return left < right
  return left <= right
}

function pointer(value: unknown, path: string): unknown {
  if (path === "") return value
  let current = value
  for (const encoded of path.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~")
    if (
      unsafeSegments.has(segment) ||
      !isRecord(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function scalarEntity(value: unknown): value is string | number {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function groupRowsByEntity(
  rows: NormalizedRow[]
): Map<string, NormalizedRow[]> {
  const grouped = new Map<string, NormalizedRow[]>()
  for (const row of rows) {
    const existing = grouped.get(row.entity) ?? []
    existing.push(row)
    grouped.set(row.entity, existing)
  }
  return grouped
}
