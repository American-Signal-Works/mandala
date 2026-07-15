"use client";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@workspace/ui/components/field";
import { Separator } from "@workspace/ui/components/separator";
import { signOut } from "@/actions/auth";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function AccountForm({ email }: { email: string }) {
  return (
    <div className="space-y-6">
      <FieldGroup>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldDescription>{email}</FieldDescription>
        </Field>
      </FieldGroup>

      <Separator />

      <form action={signOut}>
        <Button type="submit" variant="outline">Sign out</Button>
      </form>

      <Separator />

      <div>
        <h2 className="text-base font-semibold text-destructive mb-2">Danger zone</h2>
        <DeleteAccountDialog />
      </div>
    </div>
  );
}
