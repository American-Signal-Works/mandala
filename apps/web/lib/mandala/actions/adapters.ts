import type { ExecutionMode, ExecutorAdapter } from "./contracts"

export function createSimulationAdapter(input: {
  execute: (
    requestInput: Record<string, unknown>
  ) => Promise<Record<string, unknown>> | Record<string, unknown>
}): ExecutorAdapter {
  return {
    async execute(request, context) {
      const output = await input.execute(structuredClone(request.input))
      return {
        output,
        effect: effectForMode(context.mode),
        providerReference: null,
      }
    },
  }
}

function effectForMode(
  mode: Exclude<ExecutionMode, "live">
): "simulated" | "observed" {
  return mode === "shadow" ? "observed" : "simulated"
}
