// apps/web/playwright.config.ts
import { defineConfig } from "@playwright/test"

// Use production build for E2E so routes are pre-compiled.
// Plate.js + its kit pulls a lot of code into /p/[pageId]; first-hit dev
// compile of that route can exceed 30s, breaking Playwright timeouts.
const useProdServer = !!process.env.CI || !!process.env.PLAYWRIGHT_PROD

export default defineConfig({
  testDir: "../../tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    headless: true,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: useProdServer
      ? "pnpm --filter web build && pnpm --filter web start"
      : "pnpm dev",
    url: "http://localhost:3000",
    cwd: "../..",
    reuseExistingServer: !process.env.CI,
    timeout: 480_000, // 8 minutes — Plan 5 added emoji-mart + Sentry, build is now ~3-4 min
    // Plate.js + emoji-mart + Sentry instrumentation push the Next.js prod
    // server past the default ~2GB Node heap; bump it so E2E stays alive.
    env: { NODE_OPTIONS: "--max-old-space-size=4096" },
  },
})
