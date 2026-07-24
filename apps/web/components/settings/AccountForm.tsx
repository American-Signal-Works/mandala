"use client"

import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Separator } from "@workspace/ui/components/separator"

import { signOut } from "@/actions/auth"
import { CliSessionsForm } from "./CliSessionsForm"
import { DeleteAccountDialog } from "./DeleteAccountDialog"

export function AccountForm({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-6">
      <FieldGroup>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldDescription>{email}</FieldDescription>
        </Field>
      </FieldGroup>

      <Separator />

      <CliSessionsForm />

      <Separator />

      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>

      <Separator />

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-destructive">
          Danger zone
        </h2>
        <DeleteAccountDialog />
      </div>
    </div>
  )
}
