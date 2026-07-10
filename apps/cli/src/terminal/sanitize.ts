const ESCAPE = 0x1b
const DELETE = 0x7f
const C1_START = 0x80
const C1_END = 0x9f
const CSI = 0x9b
const OSC = 0x9d
const STRING_TERMINATOR = 0x9c

const C1_STRING_CONTROLS = new Set([0x90, 0x98, 0x9e, 0x9f])

export function sanitizeTerminalText(value: string): string {
  let result = ""
  let index = 0

  while (index < value.length) {
    const code = value.charCodeAt(index)

    if (code === ESCAPE) {
      index = skipEscapeSequence(value, index)
      continue
    }
    if (code === CSI) {
      index = skipCsi(value, index + 1)
      continue
    }
    if (code === OSC || C1_STRING_CONTROLS.has(code)) {
      index = skipControlString(value, index + 1)
      continue
    }
    if (code >= C1_START && code <= C1_END) {
      index += 1
      continue
    }
    if (code < 0x20 || code === DELETE) {
      if (code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c)
        result += " "
      index += 1
      continue
    }
    if (isUnsafeUnicodeControl(code)) {
      if (code === 0x2028 || code === 0x2029) result += " "
      index += 1
      continue
    }

    result += value[index]
    index += 1
  }

  return result
}

function skipEscapeSequence(value: string, index: number): number {
  const next = value.charCodeAt(index + 1)
  if (Number.isNaN(next)) return value.length
  if (next === 0x5b) return skipCsi(value, index + 2)
  if (next === 0x5d || [0x50, 0x58, 0x5e, 0x5f].includes(next))
    return skipControlString(value, index + 2)

  let cursor = index + 1
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor)
    cursor += 1
    if (code >= 0x30 && code <= 0x7e) return cursor
    if (code < 0x20 || code > 0x2f) return cursor
  }
  return cursor
}

function skipCsi(value: string, index: number): number {
  let cursor = index
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor)
    cursor += 1
    if (code >= 0x40 && code <= 0x7e) return cursor
  }
  return cursor
}

function skipControlString(value: string, index: number): number {
  let cursor = index
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor)
    if (code === 0x07 || code === STRING_TERMINATOR) return cursor + 1
    if (
      code === ESCAPE &&
      cursor + 1 < value.length &&
      value.charCodeAt(cursor + 1) === 0x5c
    ) {
      return cursor + 2
    }
    cursor += 1
  }
  return cursor
}

function isUnsafeUnicodeControl(code: number): boolean {
  return (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x2066 && code <= 0x2069)
  )
}
