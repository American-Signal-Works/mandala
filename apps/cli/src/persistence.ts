import { randomBytes } from "node:crypto"
import {
  open,
  readFile,
  rename,
  rm,
  chmod,
  mkdir,
  lstat,
} from "node:fs/promises"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import type { RuntimeEnvironment } from "./environment.js"
import { CliError } from "./errors.js"

const selectedCompanySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
  })
  .strict()

export const storedConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("mock"),
    selectedCompany: selectedCompanySchema.nullable(),
  })
  .strict()

export const storedSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive(),
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email().nullable(),
      })
      .strict(),
  })
  .strict()

export type StoredConfig = z.infer<typeof storedConfigSchema>
export type StoredSession = z.infer<typeof storedSessionSchema>

export function resolveConfigDirectory(
  environment: RuntimeEnvironment
): string {
  assertSupportedPlatform()
  if (environment.MANDALA_CONFIG_DIR) return environment.MANDALA_CONFIG_DIR
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "Mandala")
  return join(
    environment.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "mandala"
  )
}

export class SecureStore {
  readonly configPath: string
  readonly sessionPath: string

  constructor(readonly directory: string) {
    assertSupportedPlatform()
    this.configPath = join(directory, "config.json")
    this.sessionPath = join(directory, "session.json")
  }

  async readConfig(): Promise<StoredConfig> {
    return (
      (await readPrivateJson(this.configPath, storedConfigSchema)) ??
      defaultConfig()
    )
  }

  async writeConfig(config: StoredConfig): Promise<void> {
    await writePrivateJson(
      this.directory,
      this.configPath,
      storedConfigSchema.parse(config)
    )
  }

  async readSession(): Promise<StoredSession | null> {
    return readPrivateJson(this.sessionPath, storedSessionSchema)
  }

  async writeSession(session: StoredSession): Promise<void> {
    await writePrivateJson(
      this.directory,
      this.sessionPath,
      storedSessionSchema.parse(session)
    )
  }

  async deleteSession(): Promise<void> {
    await rm(this.sessionPath, { force: true })
  }

  async clearSelectedCompany(): Promise<void> {
    const config = await this.readConfig()
    await this.writeConfig({ ...config, selectedCompany: null })
  }
}

function assertSupportedPlatform(): void {
  if (platform() === "win32")
    throw new CliError(
      "unsupported_platform",
      "Windows credential storage is not supported by this CLI build."
    )
}

function defaultConfig(): StoredConfig {
  return { schemaVersion: 1, mode: "mock", selectedCompany: null }
}

async function readPrivateJson<T>(
  path: string,
  schema: z.ZodType<T>
): Promise<T | null> {
  try {
    const stats = await lstat(path)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new CliError(
        "unsafe_config_file",
        "A local Mandala file is not a regular file."
      )
    }
    if (platform() !== "win32" && (stats.mode & 0o077) !== 0) {
      throw new CliError(
        "unsafe_config_permissions",
        "A local Mandala file must be readable only by its owner."
      )
    }
    const source = await readFile(path, "utf8")
    return schema.parse(JSON.parse(source) as unknown)
  } catch (error) {
    if (error instanceof CliError) throw error
    if (isMissingFile(error)) return null
    throw new CliError(
      "invalid_local_state",
      "A local Mandala file is unreadable or invalid."
    )
  }
}

async function writePrivateJson(
  directory: string,
  path: string,
  value: unknown
): Promise<void> {
  await ensurePrivateDirectory(directory)

  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, path)
    if (platform() !== "win32") await chmod(path, 0o600)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    if (error instanceof CliError) throw error
    throw new CliError(
      "local_state_write_failed",
      "The local Mandala state could not be saved securely."
    )
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const stats = await lstat(directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new CliError(
        "unsafe_config_directory",
        "The Mandala config path must be a private directory, not a symbolic link."
      )
    }
    if (platform() !== "win32") await chmod(directory, 0o700)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(
      "local_state_write_failed",
      "The local Mandala state directory could not be secured."
    )
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  )
}
