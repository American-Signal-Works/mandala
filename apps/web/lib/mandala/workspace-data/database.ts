export type WorkspaceDatabaseError = { message: string; code?: string }
export type WorkspaceDatabaseResult<T> = {
  data: T | null
  error: WorkspaceDatabaseError | null
  count?: number | null
}

export type WorkspaceQuery<T> = PromiseLike<WorkspaceDatabaseResult<T[]>> & {
  select(columns?: string, options?: Record<string, unknown>): WorkspaceQuery<T>
  eq(column: string, value: unknown): WorkspaceQuery<T>
  in(column: string, values: readonly unknown[]): WorkspaceQuery<T>
  order(column: string, options?: Record<string, unknown>): WorkspaceQuery<T>
  limit(count: number): WorkspaceQuery<T>
  single(): PromiseLike<WorkspaceDatabaseResult<T>>
  maybeSingle(): PromiseLike<WorkspaceDatabaseResult<T>>
}

export type WorkspaceDatabase = {
  from<T = Record<string, unknown>>(table: string): WorkspaceQuery<T>
  rpc<T = unknown>(
    functionName: string,
    args?: Record<string, unknown>
  ): PromiseLike<WorkspaceDatabaseResult<T>>
}

export function asWorkspaceDatabase(value: unknown): WorkspaceDatabase {
  return value as WorkspaceDatabase
}

export function dataOrThrow<T>(result: WorkspaceDatabaseResult<T>): T {
  if (result.error) throw new Error(result.error.message)
  if (result.data === null) throw new Error("Workspace data was not found.")
  return result.data
}

export function rowsOrThrow<T>(result: WorkspaceDatabaseResult<T[]>): T[] {
  if (result.error) throw new Error(result.error.message)
  return result.data ?? []
}
