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
import { isSensitiveKey, redactSecretText } from "./output.js"
import {
  isSlashCommandAvailable,
  paletteSlashCommands,
  suggestSlashCommands,
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
  itemType?: string
  nextAction?: string
  owner?: string
  priority?: string
  source?: string
  status: string
  title: string
  warningCount?: number
}

export type TuiWorkspace = {
  id?: string
  name: string
}

export type TuiSessionSnapshot = {
  environment?: string
  nextAction?: string
  selectedItem?: TuiSelectedItem
  userEmail?: string
  workspace?: TuiWorkspace
}

export type TuiAppendKind = "error" | "output" | "prompt" | "user"

export type TuiChoice = {
  value: string
  label: string
  description?: string
}

export type TuiSessionIo = {
  append: (value: string, kind?: TuiAppendKind) => void
  ask: (prompt: string) => Promise<string | null>
  choose?: (
    prompt: string,
    choices: readonly TuiChoice[]
  ) => Promise<string | null>
  clearScreen: () => void
  onSnapshot: (snapshot: TuiSessionSnapshot) => void
  renderOptions: TuiRenderOptions
}

export type TuiSessionController = {
  readonly exitRequested: boolean
  cancelCurrentOperation: () => boolean
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
const WORKING_FRAMES = ["-", "\\", "|", "/"] as const
export const RESIZE_SETTLE_MS = 250

export const inkRenderConfiguration = {
  alternateScreen: false,
  exitOnCtrlC: false,
  incrementalRendering: false,
} as const

type ResizeListener = (...arguments_: unknown[]) => void

export function createSettledResizeOutput<T extends NodeJS.WriteStream>(
  output: T,
  delay = RESIZE_SETTLE_MS
): { dispose: () => void; output: T } {
  const listeners = new Set<ResizeListener>()
  let inkResizeListener: ResizeListener | undefined
  let pendingArguments: unknown[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const resized = (...arguments_: unknown[]) => {
    pendingArguments = arguments_
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      for (const listener of [...listeners]) {
        listener.apply(proxy, pendingArguments)
      }
    }, delay)
  }

  output.on("resize", resized)
  const proxy = new Proxy(output, {
    get(target, property) {
      if (property === "on" || property === "addListener") {
        return (event: string | symbol, listener: ResizeListener) => {
          if (event === "resize") {
            // Ink registers its own immediate redraw before React mounts the app.
            // The component render already recalculates layout, so retaining that
            // first listener would paint once at the old width and then paint again.
            if (inkResizeListener) listeners.add(listener)
            else inkResizeListener = listener
          } else {
            target.on(event, listener)
          }
          return proxy
        }
      }
      if (property === "off" || property === "removeListener") {
        return (event: string | symbol, listener: ResizeListener) => {
          if (event === "resize") {
            if (listener === inkResizeListener) inkResizeListener = undefined
            else listeners.delete(listener)
          } else {
            target.off(event, listener)
          }
          return proxy
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  }) as T

  return {
    dispose: () => {
      if (timer) clearTimeout(timer)
      output.off("resize", resized)
      listeners.clear()
      inkResizeListener = undefined
    },
    output: proxy,
  }
}

export function resolveTuiWidth(
  reportedWidth: number | undefined,
  fallbackWidth = DEFAULT_TUI_WIDTH
): number {
  const fallback = clampTuiWidth(fallbackWidth)
  if (
    reportedWidth === undefined ||
    !Number.isFinite(reportedWidth) ||
    reportedWidth <= 0 ||
    reportedWidth > MAX_CREDIBLE_REPORTED_WIDTH
  ) {
    return fallback
  }
  return clampTuiWidth(reportedWidth)
}

function clampTuiWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_TUI_WIDTH
  return Math.max(1, Math.min(MAX_TUI_WIDTH, Math.floor(width)))
}

function normalizeTuiHeight(rows: number | undefined): number {
  return typeof rows === "number" && Number.isFinite(rows) && rows > 0
    ? Math.floor(rows)
    : 24
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

type ChoiceRequest = {
  choices: readonly TuiChoice[]
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
  const settledOutput = createSettledResizeOutput(
    input.stdout as NodeJS.WriteStream
  )
  const instance = render(
    <MandalaTui
      clearTerminal={clearTerminal}
      color={input.color}
      createSession={input.createSession}
      width={input.width}
    />,
    {
      ...inkRenderConfiguration,
      interactive: true,
      patchConsole: false,
      stderr: input.stderr as NodeJS.WriteStream,
      stdin: input.stdin as NodeJS.ReadStream,
      stdout: settledOutput.output,
    }
  )
  instanceRef.current = instance
  try {
    await instance.waitUntilExit()
  } finally {
    settledOutput.dispose()
    instance.cleanup()
  }
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
  const { columns, rows } = useWindowSize()
  const currentWidth = resolveTuiWidth(columns, width)
  const currentHeight = normalizeTuiHeight(rows)
  const mounted = useRef(true)
  const nextEntryId = useRef(0)
  const choiceRef = useRef<ChoiceRequest | undefined>(undefined)
  const promptRef = useRef<PromptRequest | undefined>(undefined)
  const started = useRef(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [choiceIndex, setChoiceIndex] = useState(0)
  const [choice, setChoice] = useState<ChoiceRequest | undefined>(undefined)
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
  const [workingLabel, setWorkingLabel] = useState(
    "Loading workspace and inbox"
  )

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

  const choose = useCallback(
    (label: string, choices: readonly TuiChoice[]) =>
      new Promise<string | null>((resolve) => {
        const request = { choices, label, resolve }
        choiceRef.current = request
        setChoice(request)
        setChoiceIndex(0)
        setInputValue("")
        setInputRevision((current) => current + 1)
        setPaletteDismissed(true)
      }),
    []
  )

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
        choose,
        clearScreen,
        onSnapshot: snapshotChanged,
        renderOptions: { color, width },
      }),
    [
      append,
      ask,
      choose,
      clearScreen,
      color,
      createSession,
      snapshotChanged,
      width,
    ]
  )

  useEffect(() => {
    if (started.current || currentWidth < MIN_TUI_WIDTH) return
    started.current = true
    void session.start().finally(() => {
      if (mounted.current) setWorking(false)
    })
  }, [currentWidth, session])

  useEffect(() => {
    return () => {
      mounted.current = false
      choiceRef.current?.resolve(null)
      promptRef.current?.resolve(null)
      session.clearState()
    }
  }, [session])

  const palette = useMemo(
    () => matchingCommands(inputValue, snapshot),
    [inputValue, snapshot]
  )
  const commandPaletteActive =
    !prompt &&
    !choice &&
    !working &&
    !paletteDismissed &&
    /^\/[^\s]*$/.test(inputValue)
  const paletteOpen = commandPaletteActive && palette.length > 0
  const paletteEmpty = commandPaletteActive && palette.length === 0
  const selectedCommand = palette[activeIndex] ?? palette[0]

  useEffect(() => setActiveIndex(0), [inputValue, palette.length])

  const finish = useCallback(() => {
    mounted.current = false
    choiceRef.current?.resolve(null)
    choiceRef.current = undefined
    promptRef.current?.resolve(null)
    promptRef.current = undefined
    session.requestExit()
    session.clearState()
    exit()
  }, [exit, session])

  const cancelChoice = useCallback(() => {
    const request = choiceRef.current
    if (!request) return
    choiceRef.current = undefined
    setChoice(undefined)
    setChoiceIndex(0)
    setPaletteDismissed(false)
    append(`${sanitizeTerminalText(request.label)} cancelled.`)
    request.resolve(null)
  }, [append])

  const submitChoice = useCallback(
    (selectedIndex = choiceIndex) => {
      const request = choiceRef.current
      const selected = request?.choices[selectedIndex]
      if (!request || !selected) return
      choiceRef.current = undefined
      setChoice(undefined)
      setChoiceIndex(0)
      setPaletteDismissed(false)
      append(`Selected: ${sanitizeTerminalText(selected.label)}`, "prompt")
      request.resolve(selected.value)
    },
    [append, choiceIndex]
  )

  const cancelPrompt = useCallback(() => {
    const request = promptRef.current
    if (!request) return
    promptRef.current = undefined
    setPrompt(undefined)
    setInputValue("")
    setInputRevision((current) => current + 1)
    setPaletteDismissed(false)
    append(cancellationMessage(request.label))
    request.resolve(null)
  }, [append])

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
      if (key.ctrl && character === "c") {
        if (choice) cancelChoice()
        else if (prompt) cancelPrompt()
        else if (working && session.cancelCurrentOperation()) return
        else finish()
        return
      }
      if (key.ctrl && character === "d") {
        finish()
        return
      }
      if (choice) {
        const numericIndex = /^[1-9]$/.test(character)
          ? Number(character) - 1
          : -1
        const pageSize = choicePageSize(currentHeight)
        if (key.escape || key.leftArrow) cancelChoice()
        else if (choice.choices.length <= 9 && numericIndex >= 0)
          submitChoice(numericIndex)
        else if (key.home) setChoiceIndex(0)
        else if (key.end) setChoiceIndex(choice.choices.length - 1)
        else if (key.pageUp)
          setChoiceIndex((current) => Math.max(0, current - pageSize))
        else if (key.pageDown)
          setChoiceIndex((current) =>
            Math.min(choice.choices.length - 1, current + pageSize)
          )
        else if (key.upArrow)
          setChoiceIndex((current) =>
            current <= 0 ? choice.choices.length - 1 : current - 1
          )
        else if (key.downArrow)
          setChoiceIndex((current) => (current + 1) % choice.choices.length)
        else if (key.return || key.rightArrow) submitChoice()
        return
      }
      if (key.escape && prompt) {
        cancelPrompt()
        return
      }
      if (key.escape && commandPaletteActive) {
        setPaletteDismissed(true)
        return
      }
      if (key.escape && working && session.cancelCurrentOperation()) {
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
      if (paletteOpen && key.home) {
        setActiveIndex(0)
        return
      }
      if (paletteOpen && key.end) {
        setActiveIndex(palette.length - 1)
        return
      }
      if (paletteOpen && key.pageUp) {
        setActiveIndex((current) => Math.max(0, current - 5))
        return
      }
      if (paletteOpen && key.pageDown) {
        setActiveIndex((current) => Math.min(palette.length - 1, current + 5))
        return
      }
      if (paletteOpen && key.tab && selectedCommand) {
        completePaletteCommand(selectedCommand)
        return
      }
      if (!commandPaletteActive && !prompt && !working && key.upArrow) {
        recallHistory(-1)
        return
      }
      if (!commandPaletteActive && !prompt && !working && key.downArrow) {
        recallHistory(1)
      }
    },
    { isActive: true }
  )

  const submit = useCallback(
    async (rawValue: string) => {
      if (prompt) {
        const answer = rawValue
        const safeAnswer = projectPromptAnswer(prompt.label, answer)
        append(
          `${sanitizeTerminalText(prompt.label)}${sanitizeTerminalText(safeAnswer)}`,
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
      const safeLine = projectComposerValue(line)
      append(`> ${sanitizeTerminalText(safeLine)}`, "user")
      setHistory((current) => [...current, safeLine])
      setHistoryIndex(undefined)
      setHistoryDraft("")
      setInputValue("")
      setInputRevision((current) => current + 1)
      setPaletteDismissed(false)
      const exiting = line === "/exit" || line === "/quit"
      if (!exiting) {
        setWorkingLabel(operationLabelForLine(line))
        setWorking(true)
      }
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
      commandPaletteActive,
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

  if (currentWidth < MIN_TUI_WIDTH) {
    return (
      <Box flexDirection="column">
        <Text bold>Mandala needs a wider terminal.</Text>
        <Text>{`Current width: ${currentWidth}. Minimum width: ${MIN_TUI_WIDTH}.`}</Text>
        <Text dimColor>
          Resize the terminal to continue. Ctrl-C or Ctrl-D exits.
        </Text>
      </Box>
    )
  }

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

      <SessionContext snapshot={snapshot} width={currentWidth} />

      <Box>
        <Text dimColor>{"-".repeat(Math.max(1, currentWidth))}</Text>
      </Box>
      <Box>
        {choice ? (
          <ChoiceMenu
            choice={choice}
            height={currentHeight}
            selectedIndex={choiceIndex}
            width={currentWidth}
          />
        ) : working && !prompt ? (
          <WorkingStatus animated={color} label={workingLabel} />
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
              mask={
                isSensitiveComposerValue(prompt?.label, inputValue)
                  ? "*"
                  : undefined
              }
              placeholder={prompt ? "" : "Ask Mandala or type / for commands"}
              value={inputValue}
            />
          </>
        )}
      </Box>

      {paletteOpen ? (
        <CommandPalette commands={palette} selectedIndex={activeIndex} />
      ) : paletteEmpty ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>No command matches.</Text>
          <Text dimColor>Backspace to revise Esc close /help list all</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function ChoiceMenu(input: {
  choice: ChoiceRequest
  height: number
  selectedIndex: number
  width: number
}) {
  const { choice, height, selectedIndex, width } = input
  const visibleCount = choicePageSize(height)
  const numbered = choice.choices.length <= 9
  const maxStart = Math.max(0, choice.choices.length - visibleCount)
  const start = Math.min(
    maxStart,
    Math.max(0, selectedIndex - Math.floor(visibleCount / 2))
  )
  const visible = choice.choices.slice(start, start + visibleCount)
  const above = start
  const below = Math.max(0, choice.choices.length - start - visible.length)
  return (
    <Box flexDirection="column">
      <Text bold>
        {`${sanitizeTerminalText(choice.label)} · ${selectedIndex + 1}/${choice.choices.length}`}
      </Text>
      {above > 0 ? <Text dimColor>{`  ↑ ${above} more`}</Text> : null}
      {visible.map((option, visibleIndex) => {
        const index = start + visibleIndex
        const selected = index === selectedIndex
        const number = numbered ? `${index + 1}. ` : ""
        const description = option.description
          ? `  ${sanitizeTerminalText(option.description)}`
          : ""
        return (
          <Text
            bold={selected}
            color={selected ? "cyan" : undefined}
            dimColor={!selected}
            key={option.value}
          >
            {fitText(
              `${selected ? ">" : " "} ${number}${sanitizeTerminalText(option.label)}${description}`,
              width
            )}
          </Text>
        )
      })}
      {below > 0 ? <Text dimColor>{`  ↓ ${below} more`}</Text> : null}
      <Text dimColor>Up/Down move Home/End jump PgUp/PgDn page</Text>
      <Text dimColor>
        {`${numbered ? "1-9 select  " : ""}Left/Esc back  Right/Enter select`}
      </Text>
    </Box>
  )
}

function SessionContext(input: {
  snapshot: TuiSessionSnapshot
  width: number
}) {
  const { snapshot, width } = input
  const item = snapshot.selectedItem
  if (!item && !snapshot.workspace && !snapshot.environment) return null
  const workspace = snapshot.workspace?.name ?? "Not selected"
  const environment = snapshot.environment
    ? sanitizeTerminalText(snapshot.environment)
    : undefined
  if (!item) {
    return (
      <Box marginBottom={1}>
        <Text>
          <Text bold>Workspace</Text>
          {`  ${fitText(workspace, Math.max(8, width - 11))}`}
          {environment ? `  |  ${environment}` : ""}
        </Text>
      </Box>
    )
  }
  const warnings = item.warningCount
    ? `${item.warningCount} warning${item.warningCount === 1 ? "" : "s"}`
    : undefined
  const details = [
    item.itemType,
    item.priority,
    item.source,
    item.owner,
    warnings,
  ]
    .filter(Boolean)
    .join("  |  ")
  const nextAction = item.nextAction ?? snapshot.nextAction
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text bold>Workspace</Text>
        {`  ${fitText(workspace, Math.max(8, Math.floor(width / 3)))}`}
        {environment ? `  |  ${environment}` : ""}
      </Text>
      <Text>
        <Text bold>Selected</Text>
        {`  ${fitText(item.title, Math.max(8, width - 28))}  `}
        <Text color={item.status === "approved" ? "yellow" : "cyan"}>
          {sanitizeTerminalText(item.status)}
        </Text>
      </Text>
      {details ? <Text dimColor>{fitText(details, width)}</Text> : null}
      <Text>
        <Text bold>Next</Text>
        {`  ${fitText(nextAction ?? defaultNextAction(item.status), Math.max(8, width - 6))}`}
      </Text>
    </Box>
  )
}

function WorkingStatus(input: { animated: boolean; label: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!input.animated) return
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % WORKING_FRAMES.length),
      90
    )
    return () => clearInterval(timer)
  }, [input.animated])
  const marker = input.animated ? WORKING_FRAMES[frame] : "Working:"
  return <Text color="cyan">{`${marker} ${input.label}...`}</Text>
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
          <React.Fragment key={definition.command}>
            {index === 0 ||
            input.commands[index - 1]?.group !== definition.group ? (
              <Text bold>{definition.group}</Text>
            ) : null}
            <Text
              bold={selected}
              color={selected ? "cyan" : undefined}
              dimColor={!selected}
            >
              {`${selected ? ">" : " "} ${command}${definition.description}`}
            </Text>
          </React.Fragment>
        )
      })}
      <Text dimColor>Up/Down move Home/End jump PgUp/PgDn page</Text>
      <Text dimColor>Tab complete Enter run Esc close</Text>
    </Box>
  )
}

export function matchingCommands(
  value: string,
  snapshot: TuiSessionSnapshot
): SlashCommandDefinition[] {
  if (!/^\/[^\s]*$/.test(value)) return []
  const query = value.slice(1).toLowerCase()
  const available = paletteSlashCommands
    .filter((definition) =>
      isSlashCommandAvailable(definition, snapshot.selectedItem?.status)
    )
    .filter(
      ({ command }) =>
        (command !== "/login" || !snapshot.userEmail) &&
        (command !== "/logout" || Boolean(snapshot.userEmail))
    )
  const matches = suggestSlashCommands(query, available)
  const hasDirectMatch = available.some(({ command, description }) => {
    return (
      command.slice(1).toLowerCase().includes(query) ||
      description.toLowerCase().includes(query)
    )
  })
  const suggestionOrder = new Map(
    matches.map((definition, index) => [definition.command, index])
  )
  return matches
    .sort((left, right) => {
      const relevance = matchRank(left, query) - matchRank(right, query)
      return (
        relevance ||
        (!hasDirectMatch
          ? (suggestionOrder.get(left.command) ?? 0) -
            (suggestionOrder.get(right.command) ?? 0)
          : 0) ||
        commandRank(left, snapshot) - commandRank(right, snapshot)
      )
    })
    .slice(0, 12)
}

function choicePageSize(height: number): number {
  return Math.max(3, Math.min(10, height - 10))
}

function matchRank(definition: SlashCommandDefinition, query: string): number {
  if (!query) return 0
  const name = definition.command.slice(1).toLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  return 3
}

function commandRank(
  definition: SlashCommandDefinition,
  snapshot: TuiSessionSnapshot
): number {
  if (snapshot.selectedItem) {
    if (definition.command === "/execute") return 0
    if (definition.group === "Decide") return 10
    if (definition.group === "Inspect selected") return 20
    if (definition.command === "/inbox" || definition.command === "/unselect")
      return 30
    if (definition.group === "Review work") return 40
    if (definition.group === "Session") return 50
    return 60
  }
  if (definition.command === "/inbox") return 0
  if (definition.group === "Review work") return 10
  if (definition.group === "Agents") return 20
  if (definition.group === "Account") return 30
  if (definition.group === "Session") return 40
  return 50
}

export function operationLabelForLine(line: string): string {
  const command = line.trim().split(/\s+/, 1)[0]?.toLowerCase()
  switch (command) {
    case "/login":
      return "Starting sign in"
    case "/auth-status":
      return "Checking sign-in status"
    case "/logout":
      return "Signing out"
    case "/companies":
    case "/company":
    case "/workspace":
      return "Loading workspace"
    case "/agents":
    case "/agent-list":
    case "/agent-show":
    case "/agent-versions":
      return "Loading agents"
    case "/agent-validate":
      return "Checking agent skill"
    case "/agent-install":
      return "Installing agent"
    case "/agent-test":
      return "Running Sandbox test"
    case "/agent-activate":
      return "Activating agent"
    case "/agent-deactivate":
      return "Deactivating agent"
    case "/agent-rollback":
      return "Restoring agent version"
    case "/inbox":
    case "/purchase-requests":
    case "/refresh":
      return "Refreshing inbox"
    case "/open":
      return "Opening work item"
    case "/recommendation":
      return "Loading recommendation"
    case "/evidence":
      return "Loading evidence"
    case "/draft":
      return "Loading action preview"
    case "/history":
      return "Loading activity"
    case "/approve":
      return "Reviewing approval"
    case "/reject":
    case "/deny":
      return "Recording rejection"
    case "/rework":
      return "Requesting rework"
    case "/edit":
      return "Reviewing draft changes"
    case "/execute":
      return "Running mock execution"
    case "/fixtures":
      return "Loading sandbox scenarios"
    case "/run-fixture":
      return line.includes("synthetic_agent_run")
        ? "Generating data and running test agent"
        : "Running sandbox fixture"
    default:
      return line.trim().startsWith("/") ? "Running command" : "Thinking"
  }
}

export function projectComposerValue(value: string): string {
  const withSafeAssignments = value.replace(
    /(--set\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/gi,
    (
      match,
      prefix: string,
      doubleQuoted?: string,
      singleQuoted?: string,
      bare?: string
    ) => {
      const assignment = doubleQuoted ?? singleQuoted ?? bare ?? ""
      const safe = redactSensitiveAssignment(assignment)
      if (safe === assignment) return match
      return `${prefix}${safe}`
    }
  )
  return redactSecretText(withSafeAssignments)
}

function isSensitiveComposerValue(
  promptLabel: string | undefined,
  value: string
): boolean {
  if (promptLabel?.startsWith("Edit assignment")) {
    return redactSensitiveAssignment(value) !== value
  }
  return projectComposerValue(value) !== value
}

function redactSensitiveAssignment(assignment: string): string {
  const separator = assignment.indexOf("=")
  if (separator < 0) return assignment
  const pointer = assignment.slice(0, separator)
  const encodedKey = pointer.split("/").at(-1) ?? ""
  const key = encodedKey.replaceAll("~1", "/").replaceAll("~0", "~")
  return isSensitiveKey(key) ? `${pointer}=[REDACTED]` : assignment
}

export function projectPromptAnswer(label: string, answer: string): string {
  if (label.startsWith("Edit assignment")) {
    return redactSecretText(redactSensitiveAssignment(answer))
  }
  return redactSecretText(answer)
}

function defaultNextAction(status: string): string {
  return status === "approved"
    ? "Review execution status or run /execute to retry"
    : "Review the recommendation and evidence"
}

function cancellationMessage(label: string): string {
  return label.startsWith("Execute this approved action")
    ? "Execution cancelled. The approval remains recorded."
    : "Cancelled. No changes were made."
}

function fitText(value: string, width: number): string {
  const safeValue = sanitizeTerminalText(value)
  if (safeValue.length <= width) return safeValue
  if (width <= 1) return "…"
  return `${safeValue.slice(0, width - 1)}…`
}
