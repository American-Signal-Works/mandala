"use client"
import { useEffect, useRef, useState, useTransition } from "react"
import { useTheme } from "next-themes"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@workspace/ui/components/field"
import { toast } from "sonner"
import { updateAppearance } from "@/actions/settings"

const ACCENTS = [
  "default",
  "blue",
  "emerald",
  "rose",
  "amber",
  "violet",
] as const
type Accent = (typeof ACCENTS)[number]
type Mode = "light" | "dark" | "system"

export function AppearanceForm({
  initialMode,
  initialAccent,
}: {
  initialMode: Mode
  initialAccent: Accent
}) {
  const { setTheme } = useTheme()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [accent, setAccent] = useState<Accent>(initialAccent)
  const syncedInitialMode = useRef<Mode | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (syncedInitialMode.current === initialMode) {
      return
    }

    syncedInitialMode.current = initialMode
    setMode(initialMode)
    setTheme(initialMode)
  }, [initialMode, setTheme])

  // Apply data-accent on the html element whenever it changes (immediate visual feedback).
  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent)
  }, [accent])

  function commit(mode: Mode | undefined, acc: Accent) {
    if (!mode) return // wait for next-themes to hydrate before writing to DB
    startTransition(async () => {
      const result = await updateAppearance({
        theme_mode: mode,
        theme_accent: acc,
      })
      if (!result.ok) toast.error(result.error.message)
    })
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Theme mode</FieldLabel>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => {
            if (!v) return
            const m = v as Mode
            setMode(m)
            setTheme(m)
            commit(m, accent)
          }}
        >
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          <ToggleGroupItem value="system">System</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field>
        <FieldLabel>Accent color</FieldLabel>
        <FieldDescription>
          Affects signal accents and supporting highlights.
        </FieldDescription>
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAccent(a)
                commit(mode, a)
              }}
              className={`size-8 rounded-full border-2 transition ${accent === a ? "border-foreground" : "border-transparent"}`}
              style={{ backgroundColor: SWATCHES[a] }}
              aria-label={a}
              aria-pressed={accent === a}
            />
          ))}
        </div>
      </Field>
    </FieldGroup>
  )
}

// OKLCH swatches matching the accent CSS in packages/ui/src/styles/globals.css.
// "default" uses the preset's primary token directly.
const SWATCHES: Record<Accent, string> = {
  default: "var(--signal)",
  blue: "oklch(0.587 0.193 252)",
  emerald: "oklch(0.579 0.179 145)",
  rose: "oklch(0.599 0.191 343)",
  amber: "oklch(0.534 0.141 75)",
  violet: "oklch(0.594 0.191 295)",
}
