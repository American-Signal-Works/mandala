import { handleAgentLifecycleAction } from "../lifecycle"

export const runtime = "nodejs"

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  return handleAgentLifecycleAction(request, context, "disable")
}
