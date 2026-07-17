import { describe, expect, it } from "vitest"
import { captureSandboxFingerprint } from "./proof"

describe("Sandbox persistence fingerprint", () => {
  it("captures the exact count and latest table-specific clock in one query", async () => {
    const clocks = new Map<string, string>()
    const selectCalls = new Map<string, number>()
    const supabase = {
      from: (table: string) => {
        const query = {
          select: (columns: string) => {
            selectCalls.set(table, (selectCalls.get(table) ?? 0) + 1)
            clocks.set(table, columns.split(", ")[1]!)
            return query
          },
          eq: () => query,
          order: (clock: string) => {
            clocks.set(table, clock)
            return query
          },
          limit: () => query,
          maybeSingle: async () => ({ data: null, error: null, count: 0 }),
        }
        return query
      },
    }

    const result = await captureSandboxFingerprint({
      supabase: supabase as never,
      companyId: "10000000-0000-4000-8000-000000000001",
    })

    expect(result.tables).toHaveLength(19)
    expect([...selectCalls.values()]).toEqual(Array(19).fill(1))
    expect(clocks.get("workflow_runs")).toBe("started_at")
    expect(clocks.get("agent_execution_receipts")).toBe("recorded_at")
    expect(clocks.get("workflow_action_attempts")).toBe("created_at")
    expect(result.state.workflow_runs).toEqual({ count: 0, latest: null })
  })
})
