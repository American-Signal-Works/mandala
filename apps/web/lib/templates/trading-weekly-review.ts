// apps/web/lib/templates/trading-weekly-review.ts
import type { PageTemplate } from "./types"

export const weeklyReview: PageTemplate = {
  id: "trading-weekly-review",
  name: "Weekly Review",
  description: "Recap of the trading week with KPIs and reflection prompts.",
  emoji: "📅",
  pageType: "dashboard",
  requiresCollections: [
    { name: "Trades", managed_by_connection: "ibkr-activity-statement" },
  ],
  document: [
    { type: "h1", children: [{ text: "Weekly Review" }] },
    { type: "h2", children: [{ text: "How did I do this week?" }] },
    {
      type: "card",
      children: [{ text: "" }],
      cardProps: {
        collectionId: "__TRADES__",
        metric: { kind: "sum", fieldId: "__TRADES_NETPNL__" },
        format: "currency",
      },
    },
    {
      type: "card",
      children: [{ text: "" }],
      cardProps: {
        collectionId: "__TRADES__",
        metric: { kind: "count" },
        format: "number",
      },
    },
    { type: "h2", children: [{ text: "What worked?" }] },
    { type: "p", children: [{ text: "" }] },
    { type: "h2", children: [{ text: "What didn't work?" }] },
    { type: "p", children: [{ text: "" }] },
    { type: "h2", children: [{ text: "Plan for next week" }] },
    { type: "p", children: [{ text: "" }] },
  ],
}
