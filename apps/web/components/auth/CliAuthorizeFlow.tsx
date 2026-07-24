"use client"

import { useState } from "react"
import {
  CheckCircle2,
  Command,
  Laptop,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import {
  cliDeviceAuthorizationDecisionResponseSchema,
  type CliDeviceAuthorizationInspection,
} from "@workspace/control-plane"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group"
import { Spinner } from "@workspace/ui/components/spinner"

type Company = { id: string; name: string; role: string }
type FinishedState = "approved" | "denied"

export function CliAuthorizeFlow({
  companies,
  companyLoadFailed,
  inspection,
  signedInEmail,
}: {
  companies: Company[]
  companyLoadFailed: boolean
  inspection: CliDeviceAuthorizationInspection | null
  signedInEmail: string | null
}) {
  const priorSelectionIsAvailable = companies.some(
    (company) => company.id === inspection?.selectedCompanyId
  )
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    priorSelectionIsAvailable ? (inspection?.selectedCompanyId ?? "") : ""
  )
  const [pendingAction, setPendingAction] = useState<"approve" | "deny" | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState<FinishedState | null>(null)

  async function decide(decision: FinishedState) {
    if (!inspection) return
    if (decision === "approved" && !selectedCompanyId) {
      setError("Choose a workspace before approving this CLI.")
      return
    }

    const action = decision === "approved" ? "approve" : "deny"
    setPendingAction(action)
    setError(null)
    try {
      const response = await fetch(
        "/api/mandala/cli/device-authorizations/decision",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            decision: action,
            ...(action === "approve" ? { companyId: selectedCompanyId } : {}),
          }),
        }
      )
      const body: unknown = await response.json().catch(() => null)
      const parsed =
        cliDeviceAuthorizationDecisionResponseSchema.safeParse(body)
      const responseMatchesDecision =
        parsed.success &&
        ((decision === "approved" &&
          parsed.data.status === "approved" &&
          parsed.data.company.id === selectedCompanyId) ||
          (decision === "denied" && parsed.data.status === "denied"))
      if (!response.ok || !responseMatchesDecision) {
        setError(decisionErrorMessage(response.status))
        return
      }
      setFinished(decision)
    } catch {
      setError("Mandala could not save your decision. Try again.")
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-5 py-10 text-foreground sm:px-8">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Command aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="font-heading text-base font-medium">Mandala</p>
            <p className="text-sm text-muted-foreground">CLI authorization</p>
          </div>
        </div>

        {finished ? (
          <FinishedCard state={finished} />
        ) : inspection ? (
          <ApprovalCard
            companies={companies}
            companyLoadFailed={companyLoadFailed}
            error={error}
            inspection={inspection}
            onDecide={decide}
            pendingAction={pendingAction}
            selectedCompanyId={selectedCompanyId}
            setSelectedCompanyId={setSelectedCompanyId}
            signedInEmail={signedInEmail}
          />
        ) : (
          <UnavailableCard />
        )}
      </div>
    </main>
  )
}

function UnavailableCard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-10 text-center">
        <XCircle aria-hidden="true" className="mb-4 size-10 text-destructive" />
        <h1 className="text-xl font-medium text-balance">
          Terminal request unavailable
        </h1>
        <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
          This request is missing, expired, or already used. Return to your
          terminal and run <code>mandala auth login</code> again.
        </p>
      </CardContent>
    </Card>
  )
}

function ApprovalCard({
  companies,
  companyLoadFailed,
  error,
  inspection,
  onDecide,
  pendingAction,
  selectedCompanyId,
  setSelectedCompanyId,
  signedInEmail,
}: {
  companies: Company[]
  companyLoadFailed: boolean
  error: string | null
  inspection: CliDeviceAuthorizationInspection
  onDecide: (decision: FinishedState) => void
  pendingAction: "approve" | "deny" | null
  selectedCompanyId: string
  setSelectedCompanyId: (value: string) => void
  signedInEmail: string | null
}) {
  const busy = pendingAction !== null

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>
          <h1 className="text-xl text-balance">
            Allow this CLI to access Mandala?
          </h1>
        </CardTitle>
        <CardDescription className="text-pretty">
          Confirm that these details match the terminal you just used. Signed in
          as {signedInEmail ?? "your Mandala account"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 rounded-lg bg-muted/45 p-4 sm:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 gap-3">
            <Laptop
              aria-hidden="true"
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0">
              <p className="font-medium">{inspection.clientName}</p>
              <p className="text-sm break-words text-muted-foreground">
                {inspection.clientPlatform} · version {inspection.clientVersion}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            Expires {formatExpiry(inspection.expiresAt)}
          </p>
        </div>

        <div>
          <p className="text-sm font-medium">Requested access</p>
          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
            {inspection.requestedScopes.map((scope) => (
              <li className="flex gap-3" key={scope}>
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>
                  Read workspace context and request controlled actions. Every
                  action still follows Mandala&apos;s normal approval rules.
                </span>
              </li>
            ))}
          </ul>
        </div>

        <FieldSet
          disabled={busy || companyLoadFailed || companies.length === 0}
        >
          <FieldLegend>Choose a workspace</FieldLegend>
          <RadioGroup
            onValueChange={setSelectedCompanyId}
            value={selectedCompanyId}
          >
            {companies.map((company) => (
              <FieldLabel key={company.id}>
                <Field orientation="horizontal">
                  <FieldDescription className="flex-1 text-foreground">
                    <span className="block font-medium">{company.name}</span>
                    <span className="text-muted-foreground capitalize">
                      {company.role}
                    </span>
                  </FieldDescription>
                  <RadioGroupItem value={company.id} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          {companyLoadFailed ? (
            <FieldError>
              Your workspaces could not be loaded. Refresh this page and try
              again.
            </FieldError>
          ) : companies.length === 0 ? (
            <FieldError>
              This account does not have an active Mandala workspace.
            </FieldError>
          ) : null}
        </FieldSet>

        <div className="rounded-lg border border-border bg-muted/25 p-3 text-sm text-muted-foreground">
          Only approve if you started this sign-in from your own terminal. Deny
          the request if the device details are unfamiliar.
        </div>
        <FieldError>{error}</FieldError>
      </CardContent>
      <CardFooter className="flex-col-reverse gap-2 border-t sm:flex-row sm:justify-end">
        <Button
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => onDecide("denied")}
          type="button"
          variant="secondary"
        >
          {pendingAction === "deny" && <Spinner aria-hidden="true" />}
          Deny
        </Button>
        <Button
          className="w-full sm:w-auto"
          disabled={
            busy ||
            companyLoadFailed ||
            companies.length === 0 ||
            !selectedCompanyId
          }
          onClick={() => onDecide("approved")}
          type="button"
        >
          {pendingAction === "approve" && <Spinner aria-hidden="true" />}
          Approve CLI
        </Button>
      </CardFooter>
    </Card>
  )
}

function FinishedCard({ state }: { state: FinishedState }) {
  const approved = state === "approved"
  const Icon = approved ? CheckCircle2 : XCircle
  return (
    <Card>
      <CardContent className="flex flex-col items-center py-10 text-center">
        <Icon
          aria-hidden="true"
          className={
            approved
              ? "mb-4 size-10 text-primary"
              : "mb-4 size-10 text-destructive"
          }
        />
        <h1 className="text-xl font-medium text-balance">
          {approved ? "CLI approved" : "Request denied"}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
          {approved
            ? "Return to your terminal. Mandala will finish signing in automatically."
            : "The terminal was not given access. You can safely close this page."}
        </p>
      </CardContent>
    </Card>
  )
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function decisionErrorMessage(status: number) {
  if (status === 403) return "You no longer have access to that workspace."
  if (status === 409) return "This request expired or was already decided."
  if (status === 429)
    return "Too many attempts. Wait a few minutes before trying again."
  return "Mandala could not save your decision. Try again."
}
