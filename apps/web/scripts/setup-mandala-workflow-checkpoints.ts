import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"

const connectionString = process.env.MANDALA_WORKFLOW_DATABASE_URL
if (!connectionString) {
  throw new Error("MANDALA_WORKFLOW_DATABASE_URL is required.")
}

const checkpointer = PostgresSaver.fromConnString(connectionString, {
  schema: "workflow_checkpoint",
})
await checkpointer.setup()

process.stdout.write("Mandala workflow checkpoint schema is ready.\n")
