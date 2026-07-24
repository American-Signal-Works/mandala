// apps/web/lib/templates/trading-performance-dashboard.ts
import type { PageTemplate } from "./types"

export const performanceDashboard: PageTemplate = {
  id: "trading-performance-dashboard",
  name: "Performance Dashboard",
  description:
    "KPIs, equity curve, P&L by symbol, recent trades — for IBKR-imported Trades.",
  emoji: "📊",
  pageType: "dashboard",
  requiresCollections: [
    { name: "Trades", managed_by_connection: "ibkr-activity-statement" },
  ],
  document: [
    { type: "h1", children: [{ text: "Performance Dashboard" }] },
    { type: "p", children: [{ text: "Top-line numbers, then breakdowns." }] },
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
    { type: "h2", children: [{ text: "Equity curve" }] },
    {
      type: "chart",
      children: [{ text: "" }],
      chartProps: {
        collectionId: "__TRADES__",
        chartType: "line",
        metric: { kind: "sum", fieldId: "__TRADES_NETPNL__" },
        groupByFieldId: "__TRADES_CLOSEDAT__",
        title: "Net P&L by close date",
      },
    },
    { type: "h2", children: [{ text: "P&L by symbol" }] },
    {
      type: "chart",
      children: [{ text: "" }],
      chartProps: {
        collectionId: "__TRADES__",
        chartType: "bar",
        metric: { kind: "sum", fieldId: "__TRADES_NETPNL__" },
        groupByFieldId: "__TRADES_SYMBOL__",
        title: "Net P&L by symbol",
      },
    },
    { type: "h2", children: [{ text: "Recent trades" }] },
    {
      type: "data-table",
      children: [{ text: "" }],
      tableProps: {
        collectionId: "__TRADES__",
        visibleFields: [],
        pageSize: 25,
        title: "Recent trades",
      },
    },
  ],
}
