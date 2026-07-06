import { expect, test } from "@playwright/test"

function authUrl(path: string) {
  return process.env.PLAYWRIGHT_BASE_URL
    ? new URL(path, process.env.PLAYWRIGHT_BASE_URL).toString()
    : path
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
  const emailInput = page.getByLabel("Or continue with email")
  const emailSurface = page.locator('[data-auth-email-input="true"]')
  const primaryButton = page.getByRole("button", { name: "Send Magic Link" })

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await expect(page.getByText("Don't have an account? Sign up")).toBeVisible()
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
  await expect(page.locator('[data-auth-terms="true"]')).toHaveText(
    "By signing in you agree to our terms and privacy policy"
  )

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

  expect(metrics.shell.backgroundColor).toBe("rgb(17, 17, 17)")
  expect(metrics.stack.width).toBeCloseTo(384, 0)
  expect(metrics.stack.x).toBeCloseTo(528, 0)
  expect(metrics.stack.y).toBeCloseTo(336, 0)
  expect(metrics.googleButton.y).toBeCloseTo(468, 0)
  expect(metrics.microsoftButton.y).toBeCloseTo(516, 0)
  expect(metrics.emailSurface.y).toBeCloseTo(608, 0)
  expect(metrics.primaryButton.y).toBeCloseTo(656, 0)
  for (const control of [
    metrics.googleButton,
    metrics.microsoftButton,
    metrics.emailSurface,
    metrics.primaryButton,
  ]) {
    expect(control.width).toBeCloseTo(384, 0)
    expect(control.height).toBeCloseTo(40, 0)
    expect(control.borderRadius).toBe("10px")
  }
  expect(metrics.googleButton.backgroundColor).toBe("rgb(24, 25, 26)")
  expect(metrics.microsoftButton.backgroundColor).toBe("rgb(24, 25, 26)")
  expect(metrics.emailSurface.backgroundColor).toBe("rgb(24, 25, 26)")
  expect(metrics.emailSurface.borderColor).toBe("rgb(59, 61, 63)")
  expect(metrics.primaryButton.backgroundColor).toBe("rgb(65, 130, 255)")
  expect(metrics.primaryButton.color).toBe("rgb(255, 255, 255)")

  await primaryButton.click()
  await expect(page.getByText("Enter your email address.")).not.toBeVisible()
  const invalidStack = await stack.boundingBox()
  expect(invalidStack?.width).toBeCloseTo(384, 0)
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
    lightPage.getByRole("heading", { name: "Sign in" })
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
      shellBg: getComputedStyle(shell).backgroundColor,
      shellColor: getComputedStyle(shell).color,
      primaryBg: getComputedStyle(primary).backgroundColor,
      primaryColor: getComputedStyle(primary).color,
    }
  })
  expect(lightMetrics.htmlClass).toContain("light")
  expect(lightMetrics.googleBorderColor).toBe("rgba(0, 0, 0, 0)")
  expect(lightMetrics.shellBg).toBe("rgb(245, 243, 238)")
  expect(lightMetrics.shellColor).toBe("rgb(27, 27, 25)")
  expect(lightMetrics.primaryBg).toBe("rgb(65, 130, 255)")
  expect(lightMetrics.primaryColor).toBe("rgb(255, 255, 255)")
  await lightContext.close()

  const darkContext = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    colorScheme: "dark",
    viewport: { width: 1440, height: 1024 },
  })
  const darkPage = await darkContext.newPage()
  await darkPage.goto(authUrl("/login"))
  await expect(darkPage.getByRole("heading", { name: "Sign in" })).toBeVisible()

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
  expect(darkMetrics.shellBg).toBe("rgb(17, 17, 17)")
  expect(darkMetrics.shellColor).toBe("rgb(240, 236, 230)")
  expect(darkMetrics.primaryBg).toBe("rgb(65, 130, 255)")
  expect(darkMetrics.primaryColor).toBe("rgb(255, 255, 255)")
  await darkContext.close()
})

test("/sign-up matches the approved desktop sign-up frame", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto(authUrl("/login"))
  await page.getByRole("link", { name: "Sign up" }).click()

  await expect(page).toHaveURL(/\/sign-up$/)
  await expect(page.getByRole("heading", { name: "Sign up" })).toBeVisible()
  await expect(page.getByText("Already have an account? Sign in")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign up with Google" })
  ).toBeEnabled()
  await expect(
    page.getByRole("button", { name: "Sign up with Microsoft" })
  ).toBeEnabled()
  await expect(page.locator('[data-auth-terms="true"]')).toHaveText(
    "By signing up you agree to our terms and privacy policy"
  )

  const stackBox = await page.locator('[data-auth-stack="true"]').boundingBox()
  expect(stackBox?.width).toBeCloseTo(384, 0)
  expect(stackBox?.x).toBeCloseTo(528, 0)
  expect(stackBox?.y).toBeCloseTo(336, 0)

  await page.getByRole("link", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test("/login keeps callback success on the 384px auth stack", async ({
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
  expect(stackBox?.width).toBeCloseTo(384, 0)
  expect(stackBox?.x).toBeCloseTo(528, 0)
  expect(stackBox?.y).toBeCloseTo(470, 0)
})

test("/login keeps magic-link sent on the 384px auth stack", async ({
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

  await page.getByLabel("Or continue with email").fill("person@example.com")
  await page.getByRole("button", { name: "Send Magic Link" }).click()

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Magic Link Sent" })
  ).toHaveAttribute("aria-disabled", "true")
  await expect(
    page.getByRole("button", { name: "Magic Link Sent" })
  ).toBeDisabled()
  await expect(
    page.getByText("Didn't receive email?", { exact: false })
  ).toHaveCount(0)
  await expect(stack).toHaveAttribute("data-auth-step", "link")
  const stackBox = await stack.boundingBox()
  expect(stackBox?.width).toBeCloseTo(384, 0)
  expect(stackBox?.x).toBeCloseTo(528, 0)
  expect(stackBox?.y).toBeCloseTo(336, 0)
})

test("/login renders auth controls without overlap on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(authUrl("/login"))

  const stack = page.locator('[data-auth-stack="true"]')

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign in with Google" })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Sign in with Microsoft" })
  ).toBeVisible()
  await expect(page.getByLabel("Or continue with email")).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Send Magic Link" })
  ).toBeVisible()

  const stackBox = await stack.boundingBox()
  expect(stackBox?.width).toBeLessThanOrEqual(358)
  expect(stackBox?.x).toBeGreaterThanOrEqual(16)
  expect(stackBox?.y).toBeGreaterThanOrEqual(80)
})
