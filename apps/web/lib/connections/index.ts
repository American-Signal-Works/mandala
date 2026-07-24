// apps/web/lib/connections/index.ts
import { ibkrActivityStatement } from "./ibkr-activity-statement/connection"
import type { Connection } from "./types"

export const connections: Connection<unknown>[] = [
  ibkrActivityStatement as unknown as Connection<unknown>,
]

export function findConnection(id: string): Connection<unknown> | undefined {
  return connections.find((c) => c.id === id)
}
