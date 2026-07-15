type JsonSchema = Record<string, unknown>

const supportedKeywords = new Set([
  "$schema",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
])

export function createBoundedJsonSchemaValidator(schema: JsonSchema) {
  return (value: unknown): boolean => validate(schema, value, 0)
}

function validate(schema: JsonSchema, value: unknown, depth: number): boolean {
  if (depth > 12 || Object.keys(schema).some((key) => !supportedKeywords.has(key)))
    return false
  if (Object.hasOwn(schema, "const") && !Object.is(schema.const, value))
    return false
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value)))
    return false
  if (!matchesType(schema.type, value)) return false

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      return false
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      return false
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false
    if (typeof schema.maximum === "number" && value > schema.maximum) return false
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      return false
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      return false
    const itemSchema = schema.items
    if (isRecord(itemSchema))
      return value.every((item) => validate(itemSchema, item, depth + 1))
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : []
    if (required.some((key) => !Object.hasOwn(value, key))) return false
    for (const [key, entry] of Object.entries(value)) {
      const propertySchema = properties[key]
      if (!propertySchema) {
        if (schema.additionalProperties === false) return false
        continue
      }
      if (!isRecord(propertySchema) || !validate(propertySchema, entry, depth + 1))
        return false
    }
  }
  return true
}

function matchesType(type: unknown, value: unknown): boolean {
  if (type === undefined) return true
  if (Array.isArray(type)) return type.some((entry) => matchesType(entry, value))
  if (type === "null") return value === null
  if (type === "array") return Array.isArray(value)
  if (type === "object") return isRecord(value)
  if (type === "integer") return Number.isInteger(value)
  return typeof value === type
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
