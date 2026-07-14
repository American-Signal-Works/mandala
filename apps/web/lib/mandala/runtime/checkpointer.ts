import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"

export const workflowCheckpointSchema = "workflow_checkpoint"

let configuredCheckpointer: Promise<PostgresSaver> | null = null

export function createProductionWorkflowCheckpointer() {
  const connectionString = workflowCheckpointConnectionString()
  if (!connectionString) {
    throw new Error(
      "MANDALA_WORKFLOW_DATABASE_URL is required for durable workflow runs."
    )
  }
  return PostgresSaver.fromConnString(connectionString, {
    schema: workflowCheckpointSchema,
  })
}

export async function getProductionWorkflowCheckpointer(): Promise<PostgresSaver> {
  configuredCheckpointer ??= (async () => {
    const checkpointer = createProductionWorkflowCheckpointer()
    await checkpointer.setup()
    return checkpointer
  })()
  return configuredCheckpointer
}

function workflowCheckpointConnectionString(): string | null {
  const configured = process.env.MANDALA_WORKFLOW_DATABASE_URL?.trim()
  if (configured) return configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!supabaseUrl) return null
  try {
    const hostname = new URL(supabaseUrl).hostname
    if (hostname === "127.0.0.1" || hostname === "localhost") {
      return "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    }
  } catch {
    return null
  }
  return null
}
