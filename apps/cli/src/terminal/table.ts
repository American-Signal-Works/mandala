import Table from "cli-table3"
import { sanitizeTerminalText } from "./sanitize.js"

const DEFAULT_WIDTH = 80
const MAX_WIDTH = 240
const MIN_WIDTH = 24
const NARROW_WIDTH = 70
const MAX_GRID_FIELDS = 5
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
})

const ASCII_CHARS = {
  top: "-",
  "top-mid": "+",
  "top-left": "+",
  "top-right": "+",
  bottom: "-",
  "bottom-mid": "+",
  "bottom-left": "+",
  "bottom-right": "+",
  left: "|",
  "left-mid": "+",
  mid: "-",
  "mid-mid": "+",
  right: "|",
  "right-mid": "+",
  middle: "|",
} as const

type FieldRow = {
  field: string
  type: string
  value: string
}

type Grid = {
  path: string
  columns: Array<{ key: string; label: string }>
  values: Record<string, unknown>[]
}

export function normalizeTerminalWidth(width?: number): number {
  if (width === undefined || !Number.isFinite(width)) return DEFAULT_WIDTH
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(width)))
}

export function renderStructuredSection(
  title: string,
  value: unknown,
  requestedWidth?: number
): string {
  const width = normalizeTerminalWidth(requestedWidth)
  const safeTitle = sanitizeTerminalText(title) || "Result"
  const directGrid = uniformScalarRecordArray(value, width)
  if (directGrid) {
    return [
      wrapTerminalText(safeTitle, width),
      renderGrid(directGrid, width),
    ].join("\n")
  }

  const rows: FieldRow[] = []
  const grids: Grid[] = []
  flattenValue(value, "", rows, grids, width, true)
  const sections = [wrapTerminalText(safeTitle, width)]
  if (rows.length > 0) sections.push(renderFieldRows(rows, width))
  for (const grid of grids) {
    sections.push(
      wrapTerminalText(`${safeTitle}.${grid.path}`, width),
      renderGrid(grid, width)
    )
  }
  return sections.join("\n")
}

export function renderAsciiTable(
  headers: string[],
  rows: string[][],
  requestedWidth?: number,
  weights?: number[]
): string {
  const width = normalizeTerminalWidth(requestedWidth)
  const safeHeaders = headers.map((header) => sanitizeTerminalText(header))
  const safeRows = rows.map((row) =>
    safeHeaders.map((_, index) => sanitizeTerminalText(row[index] ?? ""))
  )
  const colWidths = allocateColumnWidths(
    width,
    safeHeaders,
    safeRows,
    weights
  )
  const table = new Table({
    chars: ASCII_CHARS,
    colWidths,
    head: safeHeaders,
    style: {
      "padding-left": 1,
      "padding-right": 1,
      border: [],
      head: [],
    },
    truncate: "...",
    wordWrap: true,
    wrapOnWordBoundary: false,
  })
  for (const row of safeRows) table.push(row)
  return table.toString()
}

export function formatScalarValue(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string")
    return JSON.stringify(sanitizeTerminalText(value))
  if (typeof value === "number")
    return Number.isFinite(value) ? JSON.stringify(value) : String(value)
  if (typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "undefined") return "undefined"
  if (typeof value === "bigint") return `${value.toString()}n`
  if (typeof value === "symbol") return sanitizeTerminalText(String(value))
  if (typeof value === "function")
    return `[Function${value.name ? ` ${sanitizeTerminalText(value.name)}` : ""}]`
  return "[object]"
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object"
}

export function wrapTerminalText(value: string, requestedWidth?: number): string {
  const width = normalizeTerminalWidth(requestedWidth)
  const safe = sanitizeTerminalText(value)
  return safe
    .split("\n")
    .flatMap((line) => wrapTerminalLine(line, width))
    .join("\n")
}

/** Approximate terminal cell width by grapheme, including common CJK, emoji,
 * combining-mark, and zero-width-joiner sequences. */
export function terminalTextWidth(value: string): number {
  const safe = sanitizeTerminalText(value)
  let width = 0
  for (const { segment } of GRAPHEME_SEGMENTER.segment(safe)) {
    if (segment === "\n") continue
    if (/\p{Extended_Pictographic}/u.test(segment) || containsWideCharacter(segment))
      width += 2
    else if (!/^\p{Mark}+$/u.test(segment)) width += 1
  }
  return width
}

function wrapTerminalLine(value: string, width: number): string[] {
  if (terminalTextWidth(value) <= width) return [value]
  let remaining = [...GRAPHEME_SEGMENTER.segment(value)].map(
    ({ segment }) => segment
  )
  const lines: string[] = []
  while (graphemesWidth(remaining) > width) {
    let used = 0
    let splitAt = 0
    let lastSpace = -1
    for (let index = 0; index < remaining.length; index += 1) {
      const segment = remaining[index] ?? ""
      const next = terminalTextWidth(segment)
      if (used + next > width) break
      used += next
      splitAt = index + 1
      if (segment === " " && used > Math.floor(width / 2)) lastSpace = index
    }
    if (lastSpace >= 0) splitAt = lastSpace
    splitAt = Math.max(1, splitAt)
    lines.push(remaining.slice(0, splitAt).join("").trimEnd())
    remaining = remaining.slice(splitAt)
    while (remaining[0] === " ") remaining.shift()
  }
  if (remaining.length > 0) lines.push(remaining.join(""))
  return lines
}

function graphemesWidth(graphemes: readonly string[]): number {
  return graphemes.reduce((total, grapheme) => total + terminalTextWidth(grapheme), 0)
}

function containsWideCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
    )
  })
}

function renderFieldRows(rows: FieldRow[], width: number): string {
  return renderAsciiTable(
    ["Field", "Type", "Value"],
    rows.map((row) => [row.field, row.type, row.value]),
    width,
    [0.28, 0.18, 0.54]
  )
}

function renderGrid(grid: Grid, width: number): string {
  const headers = ["#", ...grid.columns.map((column) => column.label)]
  const rows = grid.values.map((record, index) => [
    String(index + 1),
    ...grid.columns.map((column) => formatScalarValue(record[column.key])),
  ])
  const weights = headers.map((header, index) => {
    if (index === 0) return 0.5
    const longest = Math.max(
      header.length,
      ...rows.map((row) => row[index]?.length ?? 0)
    )
    return Math.max(4, Math.min(40, longest))
  })
  return renderAsciiTable(headers, rows, width, weights)
}

function flattenValue(
  value: unknown,
  path: string,
  rows: FieldRow[],
  grids: Grid[],
  width: number,
  allowGridExtraction: boolean
): void {
  if (isScalar(value)) {
    rows.push({
      field: path || (value === null ? "(none)" : "Value"),
      type: valueType(value),
      value: formatScalarValue(value),
    })
    return
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      rows.push({ field: path || "(empty)", type: "array", value: "[]" })
      return
    }
    const grid = allowGridExtraction
      ? uniformScalarRecordArray(value, width, path)
      : null
    if (grid) {
      grids.push(grid)
      return
    }
    value.forEach((entry, index) =>
      flattenValue(
        entry,
        `${path}[${index}]`,
        rows,
        grids,
        width,
        false
      )
    )
    return
  }

  if (!isRecord(value)) {
    rows.push({
      field: path || "Value",
      type: valueType(value),
      value: formatScalarValue(value),
    })
    return
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    rows.push({ field: path || "(empty)", type: "object", value: "{}" })
    return
  }
  for (const [key, entry] of entries) {
    flattenValue(
      entry,
      appendObjectPath(path, key),
      rows,
      grids,
      width,
      allowGridExtraction
    )
  }
}

function uniformScalarRecordArray(
  value: unknown,
  width: number,
  path = ""
): Grid | null {
  if (width < NARROW_WIDTH || !Array.isArray(value) || value.length === 0)
    return null
  if (!value.every(isRecord)) return null

  const records = value as Record<string, unknown>[]
  const keys = Object.keys(records[0] ?? {})
  if (keys.length === 0 || keys.length > MAX_GRID_FIELDS) return null
  const expected = new Set(keys)
  const uniform = records.every((record) => {
    const recordKeys = Object.keys(record)
    return (
      recordKeys.length === keys.length &&
      recordKeys.every((key) => expected.has(key)) &&
      recordKeys.every((key) => isScalar(record[key]))
    )
  })
  if (!uniform) return null

  return {
    path: path || "items",
    columns: keys.map((key) => ({
      key,
      label: sanitizeTerminalText(key),
    })),
    values: records,
  }
}

function appendObjectPath(path: string, key: string): string {
  const safeKey = sanitizeTerminalText(key)
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(safeKey))
    return path ? `${path}.${safeKey}` : safeKey
  const encoded = JSON.stringify(safeKey)
  return `${path}[${encoded}]`
}

function valueType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function allocateColumnWidths(
  width: number,
  headers: string[],
  rows: string[][],
  requestedWeights?: number[]
): number[] {
  const columnCount = headers.length
  const budget = width - (columnCount + 1)
  const minimum = 3
  const widths = Array.from({ length: columnCount }, () => minimum)
  let remaining = Math.max(0, budget - minimum * columnCount)
  const weights = headers.map((header, index) => {
    const requested = requestedWeights?.[index]
    if (requested !== undefined && requested > 0) return requested
    return Math.max(
      1,
      header.length,
      ...rows.map((row) => row[index]?.length ?? 0)
    )
  })
  const weightTotal = weights.reduce((total, weight) => total + weight, 0)

  for (let index = 0; index < widths.length; index += 1) {
    const share = Math.floor((remaining * (weights[index] ?? 1)) / weightTotal)
    widths[index] = (widths[index] ?? minimum) + share
  }
  remaining = budget - widths.reduce((total, value) => total + value, 0)
  let cursor = 0
  while (remaining > 0) {
    widths[cursor] = (widths[cursor] ?? minimum) + 1
    cursor = (cursor + 1) % widths.length
    remaining -= 1
  }
  return widths
}
