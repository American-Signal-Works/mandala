import { createHash, randomBytes, randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

const appUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const mailpitUrl = "http://127.0.0.1:54324"
const isLocalRun =
  /^http:\/\/(?:localhost|127\.0\.0\.1):/.test(appUrl) &&
  /^http:\/\/127\.0\.0\.1:54321$/.test(supabaseUrl)

test.skip(
  !isLocalRun || !anonKey || !serviceRoleKey,
  "Cycle 0.0.6 auth E2E is intentionally limited to local Supabase."
)

test("passwordless entry and invitation lifecycle stay server-confirmed", async ({
  page,
}) => {
  const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`
  const memberEmail = `cycle-006-member-${suffix}@example.test`
  const ownerEmail = `cycle-006-owner-${suffix}@example.test`
  const otherEmail = `cycle-006-other-${suffix}@example.test`
  const expiredEmail = `cycle-006-expired-${suffix}@example.test`
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const ownerPassword = `${randomBytes(24).toString("base64url")}Aa1!`
  const { data: ownerResult, error: ownerError } =
    await admin.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: true,
      password: ownerPassword,
    })
  expect(ownerError).toBeNull()
  expect(ownerResult.user).not.toBeNull()
  const owner = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: ownerSignInError } = await owner.auth.signInWithPassword({
    email: ownerEmail,
    password: ownerPassword,
  })
  expect(ownerSignInError).toBeNull()
  const { data: workspace, error: workspaceError } = await owner.rpc(
    "create_company_with_owner",
    { p_name: "Cycle 0.0.6 Browser Workspace" }
  )
  expect(workspaceError).toBeNull()
  const companyId = (workspace as { id: string }).id

  const validToken = await seedInvitation(owner, admin, {
    companyId,
    recipientEmail: memberEmail,
  })

  await page.goto(
    new URL(`/invitation?token=${encodeURIComponent(validToken)}`, appUrl).toString()
  )
  await expect(page).toHaveURL(/\/sign-up\?invitation=pending$/)
  expect(page.url()).not.toContain(validToken)
  await page.getByLabel("Continue with email").fill(memberEmail)
  await page.getByRole("button", { name: "Send magic link" }).click()
  await expect(page.getByText("Check your email")).toBeVisible()

  const magicLink = await waitForMagicLink(memberEmail)
  await clickMagicLinkFromExternalOrigin(page, magicLink)
  await expect(page).toHaveURL(/\/login\?auth=success$/)
  await expect(
    page.getByRole("heading", { name: "Sign in successful" })
  ).toBeVisible()
  await expect(page.locator("[data-nextjs-dialog]")).toHaveCount(0)

  const member = await findUserByEmail(admin, memberEmail)
  const { data: membership } = await admin
    .from("company_memberships")
    .select("role, status")
    .eq("company_id", companyId)
    .eq("user_id", member.id)
    .single()
  expect(membership).toEqual({ role: "owner", status: "active" })

  const replay = await page.request.post(
    new URL("/api/mandala/invitations/accept", appUrl).toString(),
    { data: { token: validToken }, headers: { origin: appUrl } }
  )
  expect(replay.status()).toBe(410)
  expect(await replay.json()).toEqual({ error: "invitation_used" })

  const wrongSessionToken = await seedInvitation(owner, admin, {
    companyId,
    recipientEmail: otherEmail,
  })
  await page.goto(
    new URL(
      `/invitation?token=${encodeURIComponent(wrongSessionToken)}`,
      appUrl
    ).toString()
  )
  await expect(page).toHaveURL(
    /\/sign-up\?invitation=pending&error=session_replacement_required$/
  )
  await page.getByLabel("Continue with email").fill(otherEmail)
  await page.getByRole("button", { name: "Send magic link" }).click()
  const replacementLink = await waitForMagicLink(otherEmail)
  await clickMagicLinkFromExternalOrigin(page, replacementLink)
  await expect(page).toHaveURL(/\/login\?error=session_replacement_required$/)
  await page.getByRole("button", { name: "Switch accounts" }).click()
  await expect(page).toHaveURL(/\/login\?auth=success$/)

  const replacementUser = await findUserByEmail(admin, otherEmail)
  const { data: replacementMembership } = await admin
    .from("company_memberships")
    .select("role, status")
    .eq("company_id", companyId)
    .eq("user_id", replacementUser.id)
    .single()
  expect(replacementMembership).toEqual({ role: "owner", status: "active" })

  const expiredToken = await seedInvitation(owner, admin, {
    companyId,
    recipientEmail: expiredEmail,
    expired: true,
  })
  const expired = await page.request.post(
    new URL("/api/mandala/invitations/accept", appUrl).toString(),
    { data: { token: expiredToken }, headers: { origin: appUrl } }
  )
  expect(expired.status()).toBe(410)
  expect(await expired.json()).toEqual({ error: "invitation_expired" })
})

async function clickMagicLinkFromExternalOrigin(
  page: Page,
  magicLink: string
) {
  // Mail clients and hosted inboxes are different sites from the application.
  // Starting the click at Mailpit verifies the callback cookie survives the
  // same cross-site top-level navigation a real email link creates.
  await page.goto(mailpitUrl)
  await page.evaluate((href) => {
    const link = document.createElement("a")
    link.href = href
    link.textContent = "Open magic link"
    link.dataset.testid = "magic-link"
    document.body.replaceChildren(link)
  }, magicLink)
  await page.getByTestId("magic-link").click()
}

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1_000 })
  expect(error).toBeNull()
  const user = data.users.find(
    (candidate) => candidate.email?.toLowerCase() === email.toLowerCase()
  )
  expect(user).toBeDefined()
  return user!
}

async function seedInvitation(
  owner: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  input: {
    companyId: string
    recipientEmail: string
    expired?: boolean
  }
) {
  const invitationId = randomUUID()
  const token = `mandala_invite_v1.${randomBytes(32).toString("base64url")}`
  const now = Date.now()
  const expiresAt = new Date(now + 72 * 60 * 60 * 1_000).toISOString()
  const recipientEmail = input.recipientEmail.trim().toLowerCase()

  const { error: invitationError } = await owner.rpc(
    "issue_company_invitation",
    {
      p_company_id: input.companyId,
      p_expires_at: expiresAt,
      p_invitation_id: invitationId,
      p_recipient_email: recipientEmail,
      p_token_digest: sha256(token),
    }
  )
  expect(invitationError).toBeNull()

  if (input.expired) {
    const issuedAt = new Date(now - 2 * 60 * 60 * 1_000).toISOString()
    const expiredAt = new Date(now - 60 * 60 * 1_000).toISOString()
    const { error: invitationExpiryError } = await admin
      .from("company_invitations")
      .update({ issued_at: issuedAt, expires_at: expiredAt })
      .eq("id", invitationId)
    expect(invitationExpiryError).toBeNull()
    const { error: tokenExpiryError } = await admin
      .from("company_invitation_tokens")
      .update({ issued_at: issuedAt, expires_at: expiredAt })
      .eq("invitation_id", invitationId)
    expect(tokenExpiryError).toBeNull()
  }
  return token
}

async function waitForMagicLink(email: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`)
    if (response.ok) {
      const index = (await response.json()) as {
        messages?: Array<{
          ID?: string
          To?: Array<{ Address?: string }>
        }>
      }
      const message = index.messages?.find((candidate) =>
        candidate.To?.some(
          (recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()
        )
      )
      if (message?.ID) {
        const detailResponse = await fetch(
          `${mailpitUrl}/api/v1/message/${message.ID}`
        )
        if (detailResponse.ok) {
          const detail = (await detailResponse.json()) as {
            HTML?: string
            Text?: string
          }
          const link = extractVerificationLink(
            [detail.HTML, detail.Text].filter(Boolean).join("\n")
          )
          if (link) return link
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Local auth email did not arrive in Mailpit.")
}

function extractVerificationLink(content: string) {
  const decoded = content
    .replaceAll("&amp;", "&")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
  return decoded.match(/https?:\/\/[^"'\\s<>]+\/auth\/v1\/verify[^"'\\s<>]*/)?.[0]
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
