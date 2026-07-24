"use client"
import { useState, useTransition } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { toast } from "sonner"
import { deleteAccount } from "@/actions/admin/delete-account"

export function DeleteAccountDialog() {
  const [confirm, setConfirm] = useState("")
  const [, startTransition] = useTransition()

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your workspace, pages, collections, fills,
            trades, and uploaded files. This cannot be undone. Type{" "}
            <strong>delete</strong> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="delete"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirm !== "delete"}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteAccount()
                if (!result.ok) toast.error(result.error.message)
                else window.location.href = "/login"
              })
            }
          >
            Delete forever
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
