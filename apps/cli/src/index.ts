#!/usr/bin/env node

import { runCli } from "./cli.js"
import { runTui } from "./tui.js"

const args = process.argv.slice(2)
const interactive =
  args.length === 0 &&
  process.stdin.isTTY === true &&
  process.stdout.isTTY === true

process.exitCode = interactive ? await runTui() : await runCli(args)
