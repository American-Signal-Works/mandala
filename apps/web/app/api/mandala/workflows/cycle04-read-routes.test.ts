import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkItemReviewData } from "@workspace/control-plane"
import {
  ControlPlaneQueryError,
  getWorkflowReview,
  listWorkflowActivity,
  listWorkflowQueue,
} from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"
import { GET as listItems } from "./items/route"
import { GET as reviewItem } from "./items/[itemId]/review/route"
import { GET as listActivity } from "./items/[itemId]/activity/route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/mandala/control-plane/queries", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/mandala/control-plane/queries")>()
  return {
    ...original,
    listWorkflowQueue: vi.fn(),
    getWorkflowReview: vi.fn(),
    listWorkflowActivity: vi.fn(),
  }
})

const companyId = "20000000-0000-0000-0000-000000000001"
const itemId = "33000000-0000-0000-0000-000000000001"
const snapshotId = "3e000000-0000-0000-0000-000000000001"
const auth = {
  authMode: "bearer",
  supabase: {},
  user: { id: "10000000-0000-0000-0000-000000000001" },
}

describe("Cycle 0.0.4 controlled read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(auth as never)
  })

  it("returns an opaque queue cursor bound to the normalized query", async () => {
    vi.mocked(listWorkflowQueue).mockResolvedValue({
      items: [],
      nextPage: {
        snapshotId,
        position: 25,
        snapshotAt: "2026-07-14T19:00:00.000Z",
      },
    })

    const first = await listItems(
      new Request(
        `http://localhost/api/mandala/workflows/items?companyId=${companyId}&status=active&limit=25`
      )
    )
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(body.nextCursor).not.toContain(snapshotId)

    const mismatch = await listItems(
      new Request(
        `http://localhost/api/mandala/workflows/items?companyId=${companyId}&status=blocked&limit=25&cursor=${body.nextCursor}`
      )
    )
    expect(mismatch.status).toBe(400)
    await expect(mismatch.json()).resolves.toEqual({ error: "invalid_cursor" })
    expect(listWorkflowQueue).toHaveBeenCalledTimes(1)
  })

  it("returns 400 when a signed queue snapshot has expired", async () => {
    vi.mocked(listWorkflowQueue).mockRejectedValue(
      new ControlPlaneQueryError("invalid_queue_cursor")
    )

    const response = await listItems(
      new Request(
        `http://localhost/api/mandala/workflows/items?companyId=${companyId}`
      )
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "invalid_queue_cursor",
    })
  })

  it("returns one coherent review with a separately opaque activity cursor", async () => {
    vi.mocked(getWorkflowReview).mockResolvedValue({
      ...reviewFixture(),
      activity: {
        items: [],
        nextPage: {
          beforeCreatedAt: "2026-07-14T18:00:00.000Z",
          beforeId: "3f000000-0000-0000-0000-000000000001",
        },
      },
    })

    const response = await reviewItem(
      new Request(
        `http://localhost/api/mandala/workflows/items/${itemId}/review?companyId=${companyId}`
      ),
      { params: Promise.resolve({ itemId }) }
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const body = await response.json()
    expect(body).toMatchObject({
      reviewState: "ready",
      version: "v1",
      availableActions: ["resolve"],
      activity: { items: [] },
    })
    expect(body.activity.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("returns tenant-safe absence for inaccessible review and activity", async () => {
    vi.mocked(getWorkflowReview).mockRejectedValue(
      new ControlPlaneQueryError("item_not_found")
    )
    vi.mocked(listWorkflowActivity).mockRejectedValue(
      new ControlPlaneQueryError("item_not_found")
    )

    const [review, activity] = await Promise.all([
      reviewItem(
        new Request(
          `http://localhost/api/mandala/workflows/items/${itemId}/review?companyId=${companyId}`
        ),
        { params: Promise.resolve({ itemId }) }
      ),
      listActivity(
        new Request(
          `http://localhost/api/mandala/workflows/items/${itemId}/activity?companyId=${companyId}`
        ),
        { params: Promise.resolve({ itemId }) }
      ),
    ])

    expect([review.status, activity.status]).toEqual([404, 404])
    await expect(review.json()).resolves.toEqual({ error: "item_not_found" })
    await expect(activity.json()).resolves.toEqual({ error: "item_not_found" })
  })
})

function reviewFixture(): Omit<WorkItemReviewData, "activity"> {
  return {
    item: {
      id: itemId,
      workflowRunId: "31000000-0000-0000-0000-000000000001",
      itemKey: "fixture-item",
      itemType: "po_review",
      title: "Review fixture PO",
      status: "active",
      priority: 50,
      sourceType: "fixture",
      ownerRole: "approver",
      assigneeId: null,
      dueAt: null,
      draft: null,
      nextActions: ["resolve"],
      createdAt: "2026-07-14T17:00:00.000Z",
      updatedAt: "2026-07-14T18:00:00.000Z",
    },
    recordSnapshot: null,
    recommendation: null,
    evidence: null,
    draft: null,
    policy: {
      minimumRole: "approver",
      requireHumanApproval: true,
      requireWarningAcknowledgement: false,
    },
    reviewState: "ready",
    version: "v1",
    availableActions: ["resolve"],
  }
}
