"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Separator } from "@workspace/ui/components/separator";
import { signInWithMagicLink, signInWithGoogle } from "@/actions/auth";
import { GoogleIcon } from "@/components/auth/GoogleIcon";

type FormState =
  | { kind: "idle" }
  | { kind: "validation"; message: string }
  | { kind: "submission"; message: string }
  | { kind: "sent"; email: string };

export function SignInForm() {
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [isGooglePending, startGoogleTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setState({ kind: "idle" });
    startTransition(async () => {
      const result = await signInWithMagicLink(formData);
      if (!result.ok) {
        if (result.error.code === "INVALID_INPUT") {
          setState({ kind: "validation", message: result.error.message });
        } else {
          setState({ kind: "submission", message: result.error.message });
        }
        return;
      }
      setState({ kind: "sent", email: result.data.email });
    });
  }

  function onGoogle() {
    startGoogleTransition(async () => {
      const result = await signInWithGoogle();
      if (result && !result.ok) {
        toast.error(result.error.message);
      }
    });
  }

  if (state.kind === "sent") {
    return (
      <div className="flex w-full max-w-[21.875rem] flex-col items-center gap-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <header className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.0417em]">
            Check your email
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent a magic link to{" "}
            <span className="font-medium text-foreground">{state.email}</span>.
            Click the link to sign in.
          </p>
        </header>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setState({ kind: "idle" })}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  const validationError =
    state.kind === "validation" ? state.message : undefined;
  const submissionError =
    state.kind === "submission" ? state.message : undefined;
  const formDisabled = isPending || isGooglePending;

  return (
    <div className="flex w-full max-w-[21.875rem] flex-col gap-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.0417em]">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email below to sign into your account
        </p>
      </header>

      <form action={onSubmit} noValidate>
        <FieldGroup className="gap-6">
          <Field data-invalid={validationError ? true : undefined}>
            <FieldLabel htmlFor="email" className="sr-only">
              Email
            </FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              required
              aria-invalid={validationError ? true : undefined}
              aria-describedby={validationError ? "email-error" : undefined}
              disabled={formDisabled}
              onChange={() => {
                if (state.kind !== "idle") setState({ kind: "idle" });
              }}
            />
            {validationError && (
              <FieldError id="email-error">{validationError}</FieldError>
            )}
          </Field>

          {submissionError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {submissionError}
            </div>
          )}

          <Button
            type="submit"
            disabled={formDisabled}
            className="w-full"
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Sending link…
              </>
            ) : (
              "Sign in with Email"
            )}
          </Button>
        </FieldGroup>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">OR</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={formDisabled}
        onClick={onGoogle}
      >
        {isGooglePending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Redirecting…
          </>
        ) : (
          <>
            <GoogleIcon className="size-4" />
            Continue with Google
          </>
        )}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New to Backdesk?{" "}
        <Link
          href="/sign-up"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Create an account
        </Link>
        <br />
        <Link
          href="/reset-password"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Forgot your password?
        </Link>
      </p>
    </div>
  );
}
