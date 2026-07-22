import { describe, expect, it, vi } from "vitest"
import type { WorkflowSupabaseClient } from "../workflows"
import { refreshWorkspaceCatalogForManualRun } from "./manual-run"

const companyId = "e59b0920-3281-48ec-b590-ea7731f40976"

describe("refreshWorkspaceCatalogForManualRun", () => {
  it("refreshes pending catalog profiles before a manual run", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { catalogsRefreshed: 1 }, error: null })

    await refreshWorkspaceCatalogForManualRun({
      supabase: { rpc } as unknown as WorkflowSupabaseClient,
      companyId,
    })

    expect(rpc).toHaveBeenCalledWith("refresh_workspace_data_catalog_v1", {
      p_company_id: companyId,
    })
  })

  it("stops the run when the catalog cannot be refreshed", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "refresh unavailable" },
    })

    await expect(
      refreshWorkspaceCatalogForManualRun({
        supabase: { rpc } as unknown as WorkflowSupabaseClient,
        companyId,
      })
    ).rejects.toThrow("workspace_catalog_refresh_failed: refresh unavailable")
  })
})
