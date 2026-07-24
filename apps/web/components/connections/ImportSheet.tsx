// apps/web/components/connections/ImportSheet.tsx
"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetTrigger,
} from "@workspace/ui/components/sheet"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "sonner"
import { runImport } from "@/actions/import"
import { connections } from "@/lib/connections"

export function ImportSheet({
  defaultConnectionId,
  onClose,
  children,
}: {
  defaultConnectionId?: string
  onClose?: () => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [connectionId, setConnectionId] = useState(
    defaultConnectionId ?? connections[0]?.id ?? ""
  )
  const [tz, setTz] = useState("America/New_York")
  const [file, setFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) onClose?.()
  }

  function submit() {
    if (!file) return
    const fd = new FormData()
    fd.set("connectionId", connectionId)
    fd.set("file", file)
    fd.set("settings", JSON.stringify({ sourceTimezone: tz }))
    startTransition(async () => {
      const result = await runImport(fd)
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success(
        `Imported ${result.data.fillsAdded} fills, created ${result.data.tradesAdded} trades.`
      )
      setOpen(false)
      onClose?.()
      setFile(null)
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Import data</SheetTitle>
        </SheetHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel>Connection</FieldLabel>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Source timezone</FieldLabel>
            <FieldDescription>
              Used to interpret datetimes in the file. IBKR statements default
              to your account&apos;s configured timezone.
            </FieldDescription>
            <Input
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="America/New_York"
            />
          </Field>
          <Field>
            <FieldLabel>CSV file</FieldLabel>
            <Input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        </FieldGroup>
        <SheetFooter>
          <Button onClick={submit} disabled={!file || isPending}>
            {isPending ? "Importing…" : "Import"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
