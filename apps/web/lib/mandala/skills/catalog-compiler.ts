import {
  syntheticCommerceCapabilityDefinitions,
  syntheticCommerceConnectorDefinition,
} from "../capabilities"
import type { CompilerCapability } from "./compiler"

export function syntheticCompilerCapabilities(
  input: {
    healthy?: boolean
    granted?: boolean
  } = {}
): CompilerCapability[] {
  return syntheticCommerceCapabilityDefinitions.map((definition) => ({
    id: definition.key,
    version: definition.version,
    access: definition.operations.includes("execute")
      ? "execute"
      : definition.operations.includes("propose")
        ? "propose"
        : "read",
    connectorId: syntheticCommerceConnectorDefinition.key,
    schemaDigest: definition.schemaDigest,
    toolName: definition.key.replaceAll(".", "_"),
    healthy: input.healthy ?? true,
    granted: input.granted ?? true,
    modelAllowedPaths: definition.modelEgress.fields
      .filter((field) => field.modelAllowed)
      .map((field) => field.path),
  }))
}
