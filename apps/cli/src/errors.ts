export class CliError extends Error {
  auditRecorded = false

  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 1
  ) {
    super(message)
    this.name = "CliError"
  }
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error
  return new CliError("unexpected_error", "The command failed unexpectedly.")
}
