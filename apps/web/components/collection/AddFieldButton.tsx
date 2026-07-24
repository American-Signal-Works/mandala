"use client"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@workspace/ui/components/sheet"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { addField } from "@/actions/collections"
import type { FieldType } from "@/lib/collections/types"

const TYPE_OPTIONS: Array<{ value: FieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
]

export function AddFieldButton({ collectionId }: { collectionId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<FieldType>("text")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function submit() {
    if (!name.trim()) return
    startTransition(async () => {
      const result = await addField({
        collectionId,
        name: name.trim(),
        type,
        options: [],
        config: {},
      })
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      setOpen(false)
      setName("")
      setType("text")
      router.refresh()
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm">
          <Plus data-icon="inline-start" />
          Add field
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add field</SheetTitle>
        </SheetHeader>
        <div className="py-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="field-name">Name</FieldLabel>
              <Input
                id="field-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Type</FieldLabel>
              <Select
                value={type}
                onValueChange={(v) => setType(v as FieldType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </div>
        <SheetFooter>
          <Button onClick={submit} disabled={isPending || !name.trim()}>
            {isPending ? "Adding…" : "Add field"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
