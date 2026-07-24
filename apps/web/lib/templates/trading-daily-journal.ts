// apps/web/lib/templates/trading-daily-journal.ts
import type { PageTemplate } from "./types"

export const dailyJournal: PageTemplate = {
  id: "trading-daily-journal",
  name: "Daily Journal",
  description: "Free-form daily entry plus today's trades.",
  emoji: "📓",
  pageType: "dashboard",
  requiresCollections: [
    { name: "Trades", managed_by_connection: "ibkr-activity-statement" },
  ],
  document: [
    { type: "h1", children: [{ text: "Daily Journal" }] },
    {
      type: "p",
      children: [{ text: "How was today? What worked, what didn't?" }],
    },
    { type: "h2", children: [{ text: "Today's trades" }] },
    {
      type: "data-table",
      children: [{ text: "" }],
      tableProps: {
        collectionId: "__TRADES__",
        visibleFields: [],
        pageSize: 50,
      },
    },
    { type: "h2", children: [{ text: "Notes" }] },
    { type: "p", children: [{ text: "" }] },
  ],
}
