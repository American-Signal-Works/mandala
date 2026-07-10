import { lstat, mkdir, readlink, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const workspace = process.cwd()
const target = path.join(workspace, "apps/cli/dist/index.js")
const binDirectory =
  process.env.MANDALA_BIN_DIR?.trim() || path.join(os.homedir(), ".local/bin")
const link = path.join(binDirectory, "mandala")

void main()

async function main() {
  await mkdir(binDirectory, { recursive: true })

  try {
    const existing = await lstat(link)
    if (!existing.isSymbolicLink()) {
      throw new Error(
        `${link} already exists and is not a symbolic link. Remove or relocate it before linking Mandala.`
      )
    }
    const existingTarget = await readlink(link)
    if (path.resolve(binDirectory, existingTarget) !== target) {
      await rm(link)
    } else {
      console.log(`Mandala CLI is already linked at ${link}`)
      return
    }
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error
    }
  }

  await symlink(target, link, "file")
  console.log(`Linked Mandala CLI at ${link}`)

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter)
  if (!pathEntries.includes(binDirectory)) {
    console.log(
      `Add this directory to PATH before running mandala: ${binDirectory}`
    )
  }
}
