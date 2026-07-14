import "server-only"

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const skillIdPattern = /^[a-z0-9][a-z0-9-]*$/

export async function loadBundledAgentSkill(skillId: string): Promise<string> {
  if (!skillIdPattern.test(skillId))
    throw new Error("Invalid bundled skill id.")
  const errors: unknown[] = []
  for (const directory of skillDirectories()) {
    try {
      return await readFile(resolve(directory, skillId, "SKILL.md"), "utf8")
    } catch (error) {
      errors.push(error)
    }
  }
  throw new AggregateError(errors, `Bundled skill ${skillId} was not found.`)
}

export function skillDirectories(): string[] {
  return [
    ...(process.env.MANDALA_SKILLS_DIRECTORY
      ? [resolve(process.env.MANDALA_SKILLS_DIRECTORY)]
      : []),
    resolve(process.cwd(), "skills"),
    resolve(process.cwd(), "../../skills"),
  ]
}
