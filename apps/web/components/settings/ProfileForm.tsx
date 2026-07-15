"use client"
import { useState, useTransition } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@workspace/ui/components/field"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@workspace/ui/components/combobox"
import { toast } from "sonner"
import { updateProfile } from "@/actions/settings"
import { AvatarUpload } from "./AvatarUpload"

const TIMEZONES: string[] = Intl.supportedValuesOf?.("timeZone") ?? [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Tokyo",
]

export function ProfileForm({
  initialName,
  initialTimezone,
  avatarUrl,
  initialVersion,
}: {
  initialName: string
  initialTimezone: string
  avatarUrl: string | null
  initialVersion: number
}) {
  const [name, setName] = useState(initialName)
  const [tz, setTz] = useState(initialTimezone)
  const [version, setVersion] = useState(initialVersion)
  const [, startTransition] = useTransition()

  function commit(nextTz?: string) {
    startTransition(async () => {
      const result = await updateProfile({
        display_name: name,
        timezone: nextTz ?? tz,
        expected_version: version,
      })
      if (!result.ok) toast.error(result.error.message)
      else {
        setVersion(result.data.version)
        toast.success("Saved.")
      }
    })
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Avatar</FieldLabel>
        <AvatarUpload
          initialUrl={avatarUrl}
          displayName={name || "?"}
          expectedVersion={version}
          onVersionChange={setVersion}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="display-name">Display name</FieldLabel>
        <Input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit()}
        />
      </Field>
      <Field>
        <FieldLabel>Timezone</FieldLabel>
        <FieldDescription>
          Affects how datetime fields and time-window aggregations are rendered.
        </FieldDescription>
        <Combobox
          value={tz}
          onValueChange={(v: string | null) => {
            if (!v) return
            setTz(v)
            commit(v)
          }}
        >
          <ComboboxInput placeholder="Search timezones…" />
          <ComboboxContent>
            <ComboboxList>
              {TIMEZONES.map((t) => (
                <ComboboxItem key={t} value={t}>
                  {t}
                </ComboboxItem>
              ))}
              <ComboboxEmpty>No matching timezone.</ComboboxEmpty>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </Field>
      <div>
        <Button onClick={() => commit()}>Save</Button>
      </div>
    </FieldGroup>
  )
}
