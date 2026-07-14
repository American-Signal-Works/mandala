import { parseDocument } from "yaml"
import { z } from "zod"
import { agentSkillSchema, type AgentSkill } from "./schema"

export type SkillDiagnostic = {
  severity: "error" | "warning"
  code: string
  path: string
  message: string
  resolution?: string
}

export type ParsedAgentSkill = {
  skill: AgentSkill
  markdown: string
  sections: Readonly<Record<string, string>>
}

export type ParseAgentSkillResult =
  | { ok: true; value: ParsedAgentSkill; diagnostics: SkillDiagnostic[] }
  | { ok: false; diagnostics: SkillDiagnostic[] }

const requiredSections = [
  "Purpose",
  "Investigation Guidance",
  "Decision Guidance",
  "Exceptions",
  "Output Quality",
] as const

export function parseAgentSkillMarkdown(source: string): ParseAgentSkillResult {
  const normalized = source.replace(/\r\n/g, "\n")
  const frontmatter = splitFrontmatter(normalized)
  if (!frontmatter) {
    return fail(
      "skill.frontmatter_missing",
      "frontmatter",
      "The skill is missing YAML frontmatter.",
      "Start the file with --- and end the frontmatter with another --- line."
    )
  }

  const document = parseDocument(frontmatter.yaml, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0) {
    return {
      ok: false,
      diagnostics: document.errors.map((error) => ({
        severity: "error",
        code: "skill.yaml_invalid",
        path: "frontmatter",
        message: error.message,
        resolution: "Fix the YAML syntax and validate the skill again.",
      })),
    }
  }

  let raw: unknown
  try {
    raw = document.toJS({ maxAliasCount: 0 })
  } catch (error) {
    return fail(
      "skill.yaml_unsafe",
      "frontmatter",
      error instanceof Error
        ? error.message
        : "The YAML could not be read safely.",
      "Remove YAML aliases, custom tags, or executable-looking content."
    )
  }

  const parsed = agentSkillSchema.safeParse(raw)
  const diagnostics: SkillDiagnostic[] = []
  if (!parsed.success) diagnostics.push(...formatZodIssues(parsed.error))

  const sections = extractSections(frontmatter.markdown)
  for (const section of requiredSections) {
    if (!sections[section]) {
      diagnostics.push({
        severity: "error",
        code: "skill.section_missing",
        path: `markdown.${section}`,
        message: `The skill is missing the “${section}” section.`,
        resolution: `Add a ## ${section} heading with specific guidance.`,
      })
    }
  }

  const unsafe = findUnsafeProse(frontmatter.markdown)
  if (unsafe) diagnostics.push(unsafe)

  if (
    !parsed.success ||
    diagnostics.some((item) => item.severity === "error")
  ) {
    return { ok: false, diagnostics }
  }
  return {
    ok: true,
    value: { skill: parsed.data, markdown: frontmatter.markdown, sections },
    diagnostics,
  }
}

function splitFrontmatter(
  source: string
): { yaml: string; markdown: string } | null {
  if (!source.startsWith("---\n")) return null
  const end = source.indexOf("\n---\n", 4)
  if (end === -1) return null
  return { yaml: source.slice(4, end), markdown: source.slice(end + 5).trim() }
}

function extractSections(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const matches = [
    ...markdown.matchAll(/^##\s+(.+?)\s*$\n([\s\S]*?)(?=^##\s+|\s*$)/gm),
  ]
  for (const match of matches) {
    const title = match[1]?.trim()
    const body = match[2]?.trim()
    if (title && body) sections[title] = body
  }
  return sections
}

function formatZodIssues(error: z.ZodError): SkillDiagnostic[] {
  return error.issues.map((issue) => ({
    severity: "error",
    code: "skill.schema_invalid",
    path: issue.path.join(".") || "frontmatter",
    message: issue.message,
    resolution: "Correct this field to match the Skill v1 contract.",
  }))
}

function findUnsafeProse(markdown: string): SkillDiagnostic | null {
  const patterns: Array<[RegExp, string]> = [
    [/\bbypass\s+(human\s+)?approval\b/i, "approval bypass"],
    [
      /\b(reveal|print|return|log)\s+(connector\s+)?(credentials|secrets?|api\s+keys?)\b/i,
      "secret disclosure",
    ],
    [
      /\b(use|obtain|request)\s+(the\s+)?service[_ -]?role\b/i,
      "service-role escalation",
    ],
    [
      /\bexecute\s+(arbitrary\s+)?(javascript|typescript|sql|shell|bash)\b/i,
      "arbitrary code execution",
    ],
  ]
  for (const [pattern, label] of patterns) {
    if (pattern.test(markdown)) {
      return {
        severity: "error",
        code: "skill.prose_unsafe",
        path: "markdown",
        message: `The guidance requests ${label}, which Mandala does not allow.`,
        resolution:
          "Keep the skill within declared capabilities and Mandala's approval boundary.",
      }
    }
  }
  return null
}

function fail(
  code: string,
  path: string,
  message: string,
  resolution: string
): ParseAgentSkillResult {
  return {
    ok: false,
    diagnostics: [{ severity: "error", code, path, message, resolution }],
  }
}
