import type {
  CapabilityActorRole,
  CapabilityOperation,
} from "./schema"

const allOperations: CapabilityOperation[] = ["read", "propose", "execute"]

const roleOperations: Record<CapabilityActorRole, CapabilityOperation[]> = {
  owner: allOperations,
  admin: allOperations,
  approver: allOperations,
  member: ["read", "propose"],
  viewer: ["read"],
  agent: ["read", "propose"],
}

export type EffectivePermissionInput = {
  connectorOperations: readonly CapabilityOperation[]
  grantOperations: readonly CapabilityOperation[]
  workspaceOperations: readonly CapabilityOperation[]
  skillOperations: readonly CapabilityOperation[]
  actorRole: CapabilityActorRole
}

export type EffectivePermission = {
  allowedOperations: CapabilityOperation[]
  deniedOperations: CapabilityOperation[]
}

export function effectiveCapabilityPermission(
  input: EffectivePermissionInput
): EffectivePermission {
  const sets = [
    new Set(input.connectorOperations),
    new Set(input.grantOperations),
    new Set(input.workspaceOperations),
    new Set(input.skillOperations),
    new Set(roleOperations[input.actorRole]),
  ]
  const allowedOperations = allOperations.filter((operation) =>
    sets.every((candidate) => candidate.has(operation))
  )
  return {
    allowedOperations,
    deniedOperations: allOperations.filter(
      (operation) => !allowedOperations.includes(operation)
    ),
  }
}

export function roleCapabilityOperations(
  role: CapabilityActorRole
): CapabilityOperation[] {
  return [...roleOperations[role]]
}
