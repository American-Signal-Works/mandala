import { describe, expect, it } from "vitest"
import { captureSandboxFingerprint } from "./proof"

describe("Sandbox persistence fingerprint", () => {
  it("uses a valid table-specific clock for every monitored persistence surface", async () => {
    const clocks = new Map<string, string>()
    const supabase = {
      from: (table: string) => {
        const query = {
          select: (columns: string, options?: { head?: boolean }) => {
            if (!options?.head) clocks.set(table, columns.split(", ")[1]!)
            return query
          },
          eq: () => query,
          order: (clock: string) => {
            clocks.set(table, clock)
            return query
          },
          limit: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (
            resolve: (value: {
              data: never[]
              error: null
              count: number
            }) => void
          ) => resolve({ data: [], error: null, count: 0 }),
        }
        return query
      },
    }

    const result = await captureSandboxFingerprint({
      supabase: supabase as never,
      companyId: "10000000-0000-4000-8000-000000000001",
    })

    expect(result.tables).toHaveLength(19)
    expect(clocks.get("workflow_runs")).toBe("started_at")
    expect(clocks.get("agent_execution_receipts")).toBe("recorded_at")
    expect(clocks.get("workflow_action_attempts")).toBe("created_at")
    expect(result.state.workflow_runs).toEqual({ count: 0, latest: null })
  })
})
