"use client"
import { useEffect, useState } from "react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  useCommands,
  type Command,
  type CommandGroup as Group,
  type PageRow,
} from "./useCommands"

const GROUP_ORDER: Group[] = ["Navigation", "Create", "Settings", "Account"]

export function CommandPalette({ pages }: { pages: PageRow[] }) {
  const [open, setOpen] = useState(false)
  const commands = useCommands(pages)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const grouped: Record<Group, Command[]> = {
    Navigation: [],
    Create: [],
    Settings: [],
    Account: [],
  }
  for (const c of commands) grouped[c.group].push(c)

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {GROUP_ORDER.map((g, i) =>
          grouped[g].length > 0 ? (
            <div key={g}>
              {i > 0 && <CommandSeparator />}
              <CommandGroup heading={g}>
                {grouped[g].map((cmd) => (
                  <CommandItem
                    key={cmd.id}
                    value={cmd.label + " " + (cmd.keywords ?? []).join(" ")}
                    onSelect={() => {
                      void cmd.run()
                      setOpen(false)
                    }}
                  >
                    {cmd.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ) : null
        )}
      </CommandList>
    </CommandDialog>
  )
}
