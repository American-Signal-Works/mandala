import type { Readable, Writable } from "node:stream"
import {
  Box,
  Static,
  Text,
  render,
  useApp,
  useInput,
  useWindowSize,
  type Instance,
} from "ink"
import TextInput from "ink-text-input"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  paletteSlashCommands,
  type SlashCommandDefinition,
} from "./slash-commands.js"
import { sanitizeTerminalText } from "./terminal/index.js"

export type TuiRenderOptions = {
  color: boolean
  width: number
}

export type TuiSelectedItem = {
  companyId: string
  id: string
  status: string
  title: string
}

export type TuiSessionSnapshot = {
  selectedItem?: TuiSelectedItem
}

export type TuiAppendKind = "error" | "output" | "prompt" | "user"

export type TuiSessionIo = {
  append: (value: string, kind?: TuiAppendKind) => void
  ask: (prompt: string) => Promise<string | null>
  clearScreen: () => void
  onSnapshot: (snapshot: TuiSessionSnapshot) => void
  renderOptions: TuiRenderOptions
}

export type TuiSessionController = {
  readonly exitRequested: boolean
  clearState: () => void
  handleLine: (line: string) => Promise<void>
  requestExit: () => void
  start: () => Promise<void>
}

export type CreateTuiSession = (io: TuiSessionIo) => TuiSessionController

const DEFAULT_TUI_WIDTH = 80
const MIN_TUI_WIDTH = 40
const MAX_TUI_WIDTH = 120
const MAX_CREDIBLE_REPORTED_WIDTH = 240

export function resolveTuiWidth(
  reportedWidth: number | undefined,
  fallbackWidth = DEFAULT_TUI_WIDTH
): number {
  const fallback = clampTuiWidth(fallbackWidth)
  if (
    reportedWidth === undefined ||
    !Number.isFinite(reportedWidth) ||
    reportedWidth < MIN_TUI_WIDTH ||
    reportedWidth > MAX_CREDIBLE_REPORTED_WIDTH
  ) {
    return fallback
  }
  return clampTuiWidth(reportedWidth)
}

function clampTuiWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_TUI_WIDTH
  return Math.max(MIN_TUI_WIDTH, Math.min(MAX_TUI_WIDTH, Math.floor(width)))
}

type TranscriptEntry = {
  id: number
  kind: TuiAppendKind
  text: string
}

type PromptRequest = {
  label: string
  resolve: (value: string | null) => void
}

export async function runInkTui(input: {
  color: boolean
  createSession: CreateTuiSession
  stderr: Writable
  stdin: Readable
  stdout: Writable
  width: number
}): Promise<number> {
  const instanceRef: { current?: Instance } = {}
  const clearTerminal = () => instanceRef.current?.clear()
  const instance = render(
    <MandalaTui
      clearTerminal={clearTerminal}
      color={input.color}
      createSession={input.createSession}
      width={input.width}
    />,
    {
      alternateScreen: false,
      exitOnCtrlC: false,
      incrementalRendering: true,
      interactive: true,
      patchConsole: false,
      stderr: input.stderr as NodeJS.WriteStream,
      stdin: input.stdin as NodeJS.ReadStream,
      stdout: input.stdout as NodeJS.WriteStream,
    }
  )
  instanceRef.current = instance
  await instance.waitUntilExit()
  instance.cleanup()
  return 0
}

export function MandalaTui(input: {
  clearTerminal?: () => void
  color: boolean
  createSession: CreateTuiSession
  width: number
}) {
  const { clearTerminal, color, createSession, width } = input
  const { exit } = useApp()
  const { columns } = useWindowSize()
  const currentWidth = resolveTuiWidth(columns, width)
  const mounted = useRef(true)
  const nextEntryId = useRef(0)
  const promptRef = useRef<PromptRequest | undefined>(undefined)
  const started = useRef(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | undefined>(
    undefined
  )
  const [historyDraft, setHistoryDraft] = useState("")
  const [inputRevision, setInputRevision] = useState(0)
  const [inputValue, setInputValue] = useState("")
  const [paletteDismissed, setPaletteDismissed] = useState(false)
  const [prompt, setPrompt] = useState<PromptRequest | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<TuiSessionSnapshot>({})
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [working, setWorking] = useState(true)

  const append = useCallback(
    (value: string, kind: TuiAppendKind = "output") => {
      if (!mounted.current || !value) return
      const text = value.endsWith("\n") ? value.slice(0, -1) : value
      setTranscript((current) => [
        ...current,
        { id: nextEntryId.current++, kind, text },
      ])
    },
    []
  )

  const ask = useCallback((label: string) => {
    return new Promise<string | null>((resolve) => {
      const request = { label, resolve }
      promptRef.current = request
      setPrompt(request)
      setInputValue("")
      setInputRevision((current) => current + 1)
      setPaletteDismissed(true)
    })
  }, [])

  const clearScreen = useCallback(() => {
    if (!mounted.current) return
    setTranscript([])
    clearTerminal?.()
  }, [clearTerminal])

  const snapshotChanged = useCallback((next: TuiSessionSnapshot) => {
    if (mounted.current) setSnapshot(next)
  }, [])

  const session = useMemo(
    () =>
      createSession({
        append,
        ask,
        clearScreen,
        onSnapshot: snapshotChanged,
        renderOptions: { color, width },
      }),
    [append, ask, clearScreen, color, createSession, snapshotChanged, width]
  )

  useEffect(() => {
    if (started.current) return
    started.current = true
    void session.start().finally(() => {
      if (mounted.current) setWorking(false)
    })
    return () => {
      mounted.current = false
      promptRef.current?.resolve(null)
      session.clearState()
    }
  }, [session])

  const palette = useMemo(
    () => matchingCommands(inputValue, snapshot),
    [inputValue, snapshot]
  )
  const paletteOpen =
    !prompt &&
    !working &&
    !paletteDismissed &&
    /^\/[^\s]*$/.test(inputValue) &&
    palette.length > 0
  const selectedCommand = palette[activeIndex] ?? palette[0]

  useEffect(() => setActiveIndex(0), [inputValue, palette.length])

  const finish = useCallback(() => {
    mounted.current = false
    promptRef.current?.resolve(null)
    promptRef.current = undefined
    session.requestExit()
    session.clearState()
    exit()
  }, [exit, session])

  const recallHistory = useCallback(
    (direction: -1 | 1) => {
      if (!history.length) return
      if (historyIndex === undefined) {
        if (direction > 0) return
        setHistoryDraft(inputValue)
        const next = history.length - 1
        setHistoryIndex(next)
        setInputValue(history[next] ?? "")
        setInputRevision((current) => current + 1)
        return
      }
      const next = historyIndex + direction
      if (next < 0) return
      if (next >= history.length) {
        setHistoryIndex(undefined)
        setInputValue(historyDraft)
        setInputRevision((current) => current + 1)
        return
      }
      setHistoryIndex(next)
      setInputValue(history[next] ?? "")
      setInputRevision((current) => current + 1)
    },
    [history, historyDraft, historyIndex, inputValue]
  )

  const completePaletteCommand = useCallback(
    (definition: SlashCommandDefinition) => {
      setInputValue(
        definition.argumentMode === "required"
          ? `${definition.command} `
          : definition.command
      )
      setInputRevision((current) => current + 1)
      setPaletteDismissed(true)
      setActiveIndex(0)
    },
    []
  )

  useInput(
    (character, key) => {
      if (key.ctrl && (character === "c" || character === "d")) {
        finish()
        return
      }
      if (key.escape && paletteOpen) {
        setPaletteDismissed(true)
        return
      }
      if (paletteOpen && key.upArrow) {
        setActiveIndex((current) =>
          current <= 0 ? palette.length - 1 : current - 1
        )
        return
      }
      if (paletteOpen && key.downArrow) {
        setActiveIndex((current) => (current + 1) % palette.length)
        return
      }
      if (paletteOpen && key.tab && selectedCommand) {
        completePaletteCommand(selectedCommand)
        return
      }
      if (!paletteOpen && !prompt && !working && key.upArrow) {
        recallHistory(-1)
        return
      }
      if (!paletteOpen && !prompt && !working && key.downArrow) {
        recallHistory(1)
      }
    },
    { isActive: true }
  )

  const submit = useCallback(
    async (rawValue: string) => {
      if (prompt) {
        const answer = rawValue
        append(
          `${sanitizeTerminalText(prompt.label)}${sanitizeTerminalText(answer)}`,
          "prompt"
        )
        prompt.resolve(answer)
        promptRef.current = undefined
        setPrompt(undefined)
        setInputValue("")
        setInputRevision((current) => current + 1)
        setPaletteDismissed(false)
        return
      }
      if (working) return

      if (paletteOpen && selectedCommand) {
        if (selectedCommand.argumentMode === "required") {
          completePaletteCommand(selectedCommand)
          return
        }
        rawValue = selectedCommand.command
      }

      const line = rawValue.trim()
      if (!line || line === "/") return
      append(`> ${sanitizeTerminalText(line)}`, "user")
      setHistory((current) => [...current, line])
      setHistoryIndex(undefined)
      setHistoryDraft("")
      setInputValue("")
      setInputRevision((current) => current + 1)
      setPaletteDismissed(false)
      const exiting = line === "/exit" || line === "/quit"
      if (!exiting) setWorking(true)
      try {
        await session.handleLine(line)
      } finally {
        if (!exiting && mounted.current) setWorking(false)
      }
      if (session.exitRequested) finish()
    },
    [
      append,
      completePaletteCommand,
      finish,
      paletteOpen,
      prompt,
      selectedCommand,
      session,
      working,
    ]
  )

  const inputChanged = useCallback((value: string) => {
    setInputValue(value)
    setHistoryIndex(undefined)
    setPaletteDismissed(false)
  }, [])

  return (
    <Box flexDirection="column">
      <Static items={transcript}>
        {(entry) => (
          <Box key={entry.id} marginBottom={1}>
            <Text color={entry.kind === "error" ? "red" : undefined}>
              {entry.text}
            </Text>
          </Box>
        )}
      </Static>

      {snapshot.selectedItem ? (
        <SelectedContext item={snapshot.selectedItem} />
      ) : null}

      <Box>
        <Text dimColor>{"-".repeat(Math.max(1, currentWidth))}</Text>
      </Box>
      <Box>
        {working && !prompt ? (
          <WorkingStatus />
        ) : (
          <>
            <Text bold color={prompt ? "yellow" : "cyan"}>
              {prompt?.label ?? "> "}
            </Text>
            <TextInput
              focus
              key={inputRevision}
              onChange={inputChanged}
              onSubmit={(value) => void submit(value)}
              placeholder={prompt ? "" : "Ask Mandala or type / for commands"}
              value={inputValue}
            />
          </>
        )}
      </Box>

      {paletteOpen ? (
        <CommandPalette commands={palette} selectedIndex={activeIndex} />
      ) : null}
    </Box>
  )
}

function SelectedContext({ item }: { item: TuiSelectedItem }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold>Selected</Text>
        {`  ${item.title}  `}
        <Text color={item.status === "approved" ? "yellow" : "cyan"}>
          {item.status}
        </Text>
      </Text>
      <Text dimColor>{item.id}</Text>
    </Box>
  )
}

function WorkingStatus() {
  const frames = ["-", "\\", "|", "/"]
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % frames.length),
      90
    )
    return () => clearInterval(timer)
  }, [frames.length])
  return <Text color="cyan">{`${frames[frame]} Working...`}</Text>
}

function CommandPalette(input: {
  commands: readonly SlashCommandDefinition[]
  selectedIndex: number
}) {
  const commandWidth = Math.min(
    24,
    Math.max(...input.commands.map(({ command }) => command.length)) + 2
  )
  return (
    <Box flexDirection="column" marginTop={1}>
      {input.commands.map((definition, index) => {
        const selected = index === input.selectedIndex
        const command = definition.command.padEnd(commandWidth)
        return (
          <Text
            bold={selected}
            color={selected ? "cyan" : undefined}
            dimColor={!selected}
            key={definition.command}
          >
            {`${selected ? ">" : " "} ${command}${definition.description}`}
          </Text>
        )
      })}
      <Text dimColor>Up/Down select Tab complete Enter run Esc close</Text>
    </Box>
  )
}

export function matchingCommands(
  value: string,
  snapshot: TuiSessionSnapshot
): SlashCommandDefinition[] {
  if (!/^\/[^\s]*$/.test(value)) return []
  const query = value.slice(1).toLowerCase()
  return paletteSlashCommands
    .filter((definition) => isAvailable(definition, snapshot))
    .filter(({ command, description }) => {
      return (
        command.slice(1).toLowerCase().includes(query) ||
        description.toLowerCase().includes(query)
      )
    })
    .slice(0, 7)
}

function isAvailable(
  definition: SlashCommandDefinition,
  snapshot: TuiSessionSnapshot
): boolean {
  if (definition.availability === "selection") {
    return snapshot.selectedItem !== undefined
  }
  if (definition.availability === "approved-selection") {
    return snapshot.selectedItem?.status === "approved"
  }
  return true
}
