"use client"

import {
  cliSessionListResponseSchema,
  cliSessionRevocationResponseSchema,
  type CliSession,
} from "@workspace/control-plane"
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
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

type LoadState = "loading" | "ready" | "error"

export function CliSessionsForm() {
  const [sessions, setSessions] = useState<CliSession[]>([])
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [pendingTarget, setPendingTarget] = useState<string | null>(null)

  const loadSessions = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/mandala/cli/sessions", {
      cache: "no-store",
      signal,
    })
    const parsed = cliSessionListResponseSchema.safeParse(
      await response.json().catch(() => null)
    )
    if (!response.ok || !parsed.success) throw new Error("session_list_failed")
    return parsed.data.sessions
  }, [])

  const reload = useCallback(async () => {
    setLoadState("loading")
    try {
      setSessions(await loadSessions())
      setLoadState("ready")
    } catch {
      setSessions([])
      setLoadState("error")
    }
  }, [loadSessions])

  useEffect(() => {
    const controller = new AbortController()
    void loadSessions(controller.signal)
      .then((nextSessions) => {
        setSessions(nextSessions)
        setLoadState("ready")
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setLoadState("error")
      })
    return () => controller.abort()
  }, [loadSessions])

  const activeCount = useMemo(
    () => sessions.filter((session) => session.revokedAt === null).length,
    [sessions]
  )

  async function revoke(input: { sessionId: string } | { all: true }) {
    const target = "all" in input ? "all" : input.sessionId
    setPendingTarget(target)
    try {
      const response = await fetch("/api/mandala/cli/sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })
      const parsed = cliSessionRevocationResponseSchema.safeParse(
        await response.json().catch(() => null)
      )
      if (!response.ok || !parsed.success)
        throw new Error("session_revoke_failed")

      const revokedAt = new Date().toISOString()
      setSessions((current) =>
        current.map((session) =>
          ("all" in input || session.id === input.sessionId) &&
          session.revokedAt === null
            ? { ...session, revokedAt }
            : session
        )
      )
      toast.success(
        "all" in input
          ? "All CLI sessions were revoked."
          : "CLI session revoked."
      )

      try {
        setSessions(await loadSessions())
      } catch {
        toast.warning(
          "The session was revoked, but the list could not refresh. Reload this page to confirm."
        )
      }
    } catch {
      toast.error("The CLI session could not be revoked. Try again.")
    } finally {
      setPendingTarget(null)
    }
  }

  if (loadState === "loading") return <CliSessionsLoading />

  if (loadState === "error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>CLI sessions</CardTitle>
          <CardDescription>
            Review the terminals and devices that can access Mandala.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Sessions could not be loaded</EmptyTitle>
              <EmptyDescription>
                Your sessions were not changed. Try loading the list again.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              type="button"
              variant="outline"
              onClick={() => void reload()}
            >
              Try again
            </Button>
          </Empty>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CLI sessions</CardTitle>
        <CardDescription>
          Review and revoke terminals or devices that can access your Mandala
          account.
        </CardDescription>
        {activeCount > 0 ? (
          <CardAction>
            <RevokeSessionsDialog
              disabled={pendingTarget !== null}
              isPending={pendingTarget === "all"}
              label="Revoke all"
              title="Revoke all CLI sessions?"
              description="Every active CLI session for your account will stop working. You can sign in again from a trusted terminal."
              actionLabel="Revoke all sessions"
              onConfirm={() => revoke({ all: true })}
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No CLI sessions</EmptyTitle>
              <EmptyDescription>
                CLI sessions will appear here after you approve a terminal
                sign-in.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul aria-label="CLI sessions" className="flex flex-col">
            {sessions.map((session) => {
              const revoked = session.revokedAt !== null
              return (
                <li
                  key={session.id}
                  className="flex flex-col gap-4 border-t py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {session.clientName} {session.clientVersion}
                      </p>
                      <Badge variant={revoked ? "secondary" : "outline"}>
                        {revoked ? "Revoked" : "Active"}
                      </Badge>
                    </div>
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <SessionDetail
                        label="Platform"
                        value={formatPlatform(session.clientPlatform)}
                      />
                      <SessionDetail
                        label="Workspace"
                        value={workspaceLabel(session)}
                      />
                      <SessionDetail
                        label="Created"
                        value={formatDate(session.createdAt)}
                        dateTime={session.createdAt}
                      />
                      <SessionDetail
                        label="Last used"
                        value={formatDate(session.lastUsedAt)}
                        dateTime={session.lastUsedAt}
                      />
                    </dl>
                  </div>
                  {!revoked ? (
                    <RevokeSessionsDialog
                      disabled={pendingTarget !== null}
                      isPending={pendingTarget === session.id}
                      label="Revoke"
                      title={`Revoke ${session.clientName}?`}
                      description={`This stops ${session.clientName} on ${formatPlatform(session.clientPlatform)} from accessing Mandala. Other CLI sessions stay active.`}
                      actionLabel="Revoke session"
                      onConfirm={() => revoke({ sessionId: session.id })}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RevokeSessionsDialog({
  actionLabel,
  description,
  disabled,
  isPending,
  label,
  onConfirm,
  title,
}: {
  actionLabel: string
  description: string
  disabled: boolean
  isPending: boolean
  label: string
  onConfirm: () => Promise<void>
  title: string
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={disabled}
        >
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isPending}
            onClick={() => void onConfirm()}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SessionDetail({
  dateTime,
  label,
  value,
}: {
  dateTime?: string
  label: string
  value: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">
        {dateTime ? <time dateTime={dateTime}>{value}</time> : value}
      </dd>
    </div>
  )
}

function CliSessionsLoading() {
  return (
    <Card aria-busy="true" aria-label="Loading CLI sessions">
      <CardHeader>
        <CardTitle>CLI sessions</CardTitle>
        <CardDescription>
          Review the terminals and devices that can access Mandala.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  )
}

function workspaceLabel(session: CliSession) {
  if (session.selectedCompanyName) return session.selectedCompanyName
  if (session.selectedCompanyId) return "Workspace unavailable"
  return "No workspace selected"
}

function formatPlatform(platform: string) {
  const normalized = platform.toLowerCase()
  if (normalized.includes("darwin") || normalized.includes("mac"))
    return "macOS"
  if (normalized.includes("win")) return "Windows"
  if (normalized.includes("linux")) return "Linux"
  return platform
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}
