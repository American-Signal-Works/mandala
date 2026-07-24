import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConnectionCard } from "./ConnectionCard"

vi.mock("./ImportSheet", () => ({
  ImportSheet: ({
    children,
    defaultConnectionId,
  }: {
    children: ReactNode
    defaultConnectionId: string
  }) => (
    <div data-testid="import-sheet" data-connection-id={defaultConnectionId}>
      {children}
    </div>
  ),
}))

describe("ConnectionCard", () => {
  afterEach(cleanup)

  it("renders a disconnected provider from serializable display primitives", () => {
    render(
      <ConnectionCard
        connectionId="ibkr-activity-statement"
        displayName="Interactive Brokers"
        description="Import an activity statement."
        history={[]}
        isConnected={false}
      />
    )

    expect(screen.getByText("Interactive Brokers")).toBeInTheDocument()
    expect(
      screen.getByText("Import an activity statement.")
    ).toBeInTheDocument()
    expect(screen.getByText("Not yet imported")).toBeInTheDocument()
    expect(screen.getByTestId("import-sheet")).toHaveAttribute(
      "data-connection-id",
      "ibkr-activity-statement"
    )
  })

  it("renders persisted import history without a connector implementation object", () => {
    render(
      <ConnectionCard
        connectionId="ibkr-activity-statement"
        displayName="Interactive Brokers"
        description="Import an activity statement."
        history={[
          {
            filename: "activity.csv",
            imported_at: "2026-07-24T06:00:00.000Z",
            rows_added: 12,
            status: "parsed",
            error_message: null,
          },
        ]}
        isConnected
      />
    )

    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("activity.csv")).toBeInTheDocument()
    expect(screen.getByText("12")).toBeInTheDocument()
    expect(screen.getByText("parsed")).toBeInTheDocument()
  })
})
