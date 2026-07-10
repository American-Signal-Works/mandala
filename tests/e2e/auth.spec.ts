import { expect, test } from "@playwright/test"

function authUrl(path: string) {
  return process.env.PLAYWRIGHT_BASE_URL
    ? new URL(path, process.env.PLAYWRIGHT_BASE_URL).toString()
    : path
}

function expectResolvedColor(value: string) {
  expect(value).toMatch(/^(?:rgba?|hsla?|lab|lch|oklab|oklch|color)\(/)
  expect(value).not.toBe("rgba(0, 0, 0, 0)")
}

test("/login matches the approved desktop auth frame", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" })
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto(authUrl("/login"))

  const stack = page.locator('[data-auth-stack="true"]')
  const googleButton = page.getByRole("button", {
    name: "Sign in with Google",
  })
  const microsoftButton = page.getByRole("button", {
    name: "Sign in with Microsoft",
  })
  const emailInput = page.getByLabel("Continue with email")
  const emailSurface = page.locator('[data-auth-email-input="true"]')
  const primaryButton = page.getByRole("button", { name: "Send magic link" })

  await expect(
    page.getByRole("heading", { name: "Welcome to Mandala" })
  ).toBeVisible()
  await expect(page.getByText("Sign in or make an account")).toBeVisible()
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0)
  await expect(googleButton).toBeEnabled()
  await expect(microsoftButton).toBeEnabled()
  await expect(
    googleButton.locator('[data-auth-provider-icon="google"]')
  ).toBeVisible()
  await expect(
    microsoftButton.locator('[data-auth-provider-icon="microsoft"]')
  ).toBeVisible()
  await expect(emailInput).toHaveAttribute("placeholder", "user@example.com")
  await expect(page.getByText("A link will be sent to you")).not.toBeVisible()
  await expect(page.locator('[role="separator"]')).toHaveCount(0)
  await expect(
    primaryButton.locator('[data-magic-link-icon="true"]')
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const readBox = (selector: string) => {
      const element = document.querySelector(selector)

      if (!element) {
        throw new Error(`Missing selector: ${selector}`)
      }

      const box = element.getBoundingClientRect()
      const styles = window.getComputedStyle(element)

      return {
        backgroundColor: styles.backgroundColor,
        borderColor: styles.borderColor,
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        color: styles.color,
        height: box.height,
        width: box.width,
        x: box.x,
        y: box.y,
      }
    }

    return {
      shell: readBox('[data-auth-shell="true"]'),
      stack: readBox('[data-auth-stack="true"]'),
      googleButton: readBox('button[title="Sign in with Google"]'),
      microsoftButton: readBox('button[title="Sign in with Microsoft"]'),
      emailSurface: readBox('[data-auth-email-input="true"]'),
      primaryButton: readBox('[data-auth-primary-action="true"]'),
    }
  })

  expectResolvedColor(metrics.shell.backgroundColor)
  expect(metrics.stack.width).toBeCloseTo(432, 0)
  expect(metrics.stack.x).toBeCloseTo(944, 0)
  expect(metrics.stack.y).toBeCloseTo(612, 0)
  expect(metrics.googleButton.y).toBeCloseTo(684, 0)
  expect(metrics.microsoftButton.y).toBeCloseTo(684, 0)
  expect(metrics.emailSurface.y).toBeCloseTo(776, 0)
  expect(metrics.primaryButton.y).toBeCloseTo(824, 0)
  for (const control of [metrics.emailSurface, metrics.primaryButton]) {
    expect(control.width).toBeCloseTo(432, 0)
    expect(control.height).toBeCloseTo(40, 0)
    expect(control.borderRadius).toBe("10px")
  }
  for (const provider of [metrics.googleButton, metrics.microsoftButton]) {
    expect(provider.width).toBeCloseTo(212, 0)
    expect(provider.height).toBeCloseTo(40, 0)
    expect(provider.borderRadius).toBe("10px")
    expect(provider.borderColor).toBe("rgba(0, 0, 0, 0)")
    expect(provider.boxShadow).toContain("inset")
  }
  expect(metrics.emailSurface.borderColor).toBe("rgba(0, 0, 0, 0)")
  expect(metrics.emailSurface.boxShadow).toContain("inset")
  expectResolvedColor(metrics.primaryButton.backgroundColor)
  expectResolvedColor(metrics.primaryButton.color)
  expect(metrics.primaryButton.boxShadow).toContain("inset")

  await primaryButton.click()
  await expect(page.getByText("Enter your email address.")).not.toBeVisible()
  const invalidStack = await stack.boundingBox()
  expect(invalidStack?.width).toBeCloseTo(432, 0)
})

test("/login follows system light and dark theme", async ({ browser }) => {
  const lightContext = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    colorScheme: "light",
    viewport: { width: 1440, height: 1024 },
  })
  const lightPage = await lightContext.newPage()
  await lightPage.goto(authUrl("/login"))
  await expect(
    lightPage.getByRole("heading", { name: "Welcome to Mandala" })
  ).toBeVisible()

  const lightMetrics = await lightPage.evaluate(() => {
    const shell = document.querySelector('[data-auth-shell="true"]')
    const google = document.querySelector('button[title="Sign in with Google"]')
    const primary = document.querySelector('[data-auth-primary-action="true"]')

    if (!shell || !google || !primary) {
      throw new Error("Missing auth shell or primary action.")
    }

    return {
      htmlClass: document.documentElement.className,
      googleBorderColor: getComputedStyle(google).borderColor,
      googleBoxShadow: getComputedStyle(google).boxShadow,
      shellBg: getComputedStyle(shell).backgroundColor,
      shellColor: getComputedStyle(shell).color,
      primaryBg: getComputedStyle(primary).backgroundColor,
      primaryColor: getComputedStyle(primary).color,
    }
  })
  expect(lightMetrics.htmlClass).toContain("light")
  expect(lightMetrics.googleBorderColor).toBe("rgba(0, 0, 0, 0)")
  expect(lightMetrics.googleBoxShadow).toContain("inset")
  expectResolvedColor(lightMetrics.shellBg)
  expectResolvedColor(lightMetrics.shellColor)
  expectResolvedColor(lightMetrics.primaryBg)
  expectResolvedColor(lightMetrics.primaryColor)
  await lightContext.close()

  const darkContext = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    colorScheme: "dark",
    viewport: { width: 1440, height: 1024 },
  })
  const darkPage = await darkContext.newPage()
  await darkPage.goto(authUrl("/login"))
  await expect(
    darkPage.getByRole("heading", { name: "Welcome to Mandala" })
  ).toBeVisible()

  const darkMetrics = await darkPage.evaluate(() => {
    const shell = document.querySelector('[data-auth-shell="true"]')
    const primary = document.querySelector('[data-auth-primary-action="true"]')

    if (!shell || !primary) {
      throw new Error("Missing auth shell or primary action.")
    }

    return {
      htmlClass: document.documentElement.className,
      shellBg: getComputedStyle(shell).backgroundColor,
      shellColor: getComputedStyle(shell).color,
      primaryBg: getComputedStyle(primary).backgroundColor,
      primaryColor: getComputedStyle(primary).color,
    }
  })
  expect(darkMetrics.htmlClass).toContain("dark")
  expectResolvedColor(darkMetrics.shellBg)
  expectResolvedColor(darkMetrics.shellColor)
  expect(darkMetrics.shellBg).not.toBe(lightMetrics.shellBg)
  expect(darkMetrics.shellColor).not.toBe(lightMetrics.shellColor)
  expect(darkMetrics.primaryBg).toBe(lightMetrics.primaryBg)
  expect(darkMetrics.primaryColor).toBe(lightMetrics.primaryColor)
  await darkContext.close()
})

test("/sign-up matches the approved unified auth frame", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto(authUrl("/sign-up"))

  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(
    page.getByRole("heading", { name: "Welcome to Mandala" })
  ).toBeVisible()
  await expect(page.getByText("Sign in or make an account")).toBeVisible()
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Sign up" })).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Sign in with Google" })
  ).toBeEnabled()
  await expect(
    page.getByRole("button", { name: "Sign in with Microsoft" })
  ).toBeEnabled()
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible()

  const stackBox = await page.locator('[data-auth-stack="true"]').boundingBox()
  expect(stackBox?.width).toBeCloseTo(432, 0)
  expect(stackBox?.x).toBeCloseTo(944, 0)
  expect(stackBox?.y).toBeCloseTo(612, 0)
})

test("/login keeps callback success on the 432px auth stack", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto(authUrl("/login?auth=success"))

  const stack = page.locator('[data-auth-stack="true"]')

  await expect(
    page.getByRole("heading", { name: "Sign in successful" })
  ).toBeVisible()
  await expect(stack).toHaveAttribute("data-auth-step", "success")
  const stackBox = await stack.boundingBox()
  expect(stackBox?.width).toBeCloseTo(432, 0)
  expect(stackBox?.x).toBeCloseTo(944, 0)
  expect(stackBox?.y).toBeCloseTo(840, 0)
})

test("/login keeps magic-link sent on the 432px auth stack", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.route("**/auth/v1/otp*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({}),
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      status: 200,
    })
  })
  await page.goto(authUrl("/login"))

  const stack = page.locator('[data-auth-stack="true"]')

  await page.getByLabel("Continue with email").fill("person@example.com")
  await page.getByRole("button", { name: "Send magic link" }).click()

  await expect(
    page.getByRole("heading", { name: "Welcome to Mandala" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Check your email" })
  ).toHaveAttribute("aria-disabled", "true")
  await expect(
    page.getByRole("button", { name: "Check your email" })
  ).toBeDisabled()
  await expect(
    page.getByText("Didn't receive email?", { exact: false })
  ).toHaveCount(0)
  await expect(stack).toHaveAttribute("data-auth-step", "link")
  const stackBox = await stack.boundingBox()
  expect(stackBox?.width).toBeCloseTo(432, 0)
  expect(stackBox?.x).toBeCloseTo(944, 0)
  expect(stackBox?.y).toBeCloseTo(612, 0)
})

test("/login renders auth controls without overlap on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(authUrl("/login"))

  const stack = page.locator('[data-auth-stack="true"]')

  await expect(
    page.getByRole("heading", { name: "Welcome to Mandala" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign in with Google" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign in with Microsoft" })
  ).toBeVisible()
  await expect(page.getByLabel("Continue with email")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Send magic link" })
  ).toBeVisible()

  const stackBox = await stack.boundingBox()
  expect(stackBox?.width).toBeLessThanOrEqual(358)
  expect(stackBox?.x).toBeGreaterThanOrEqual(16)
  expect(stackBox?.y).toBeGreaterThanOrEqual(80)
})
