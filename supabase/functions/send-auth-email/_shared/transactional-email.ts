import {
  formatSender,
  MANDALA_MAGIC_LINK_EMAIL_THEME,
  type ResendEmailPayload,
  // @ts-expect-error Deno requires the explicit extension; web tests typecheck this shared renderer.
} from "./magic-link-email.ts"

export const WORKSPACE_INVITATION_EXPIRY_HOURS = 72

export class InvalidTransactionalEmailInputError extends Error {
  constructor() {
    super("Transactional email input is invalid.")
    this.name = "InvalidTransactionalEmailInputError"
  }
}

type WorkspaceBrand = {
  workspaceLogoUrl?: string | null
  workspaceName: string
}

export type WorkspaceInviteEmailInput = WorkspaceBrand & {
  actionUrl: string
  fromAddress: string
  inviterName: string
  recipientEmail: string
}

export type TeamRemovedEmailInput = WorkspaceBrand & {
  fromAddress: string
  removedMemberEmail: string
}

export type InviteAcceptedEmailInput = WorkspaceBrand & {
  fromAddress: string
  inviterEmail: string
  memberName: string
}

type EmailShellInput = WorkspaceBrand & {
  button?: {
    href: string
    label: string
  }
  description: string
  heading: string
  includeWorkspaceLogo?: boolean
  preheader: string
  subject: string
}

export function createWorkspaceInviteEmailPayload(
  input: WorkspaceInviteEmailInput
): ResendEmailPayload {
  const inviterName = requiredText(input.inviterName)
  const workspaceName = requiredText(input.workspaceName)
  const recipientEmail = requiredEmail(input.recipientEmail)
  const actionUrl = requiredHttpsUrl(input.actionUrl)
  const subject = `${inviterName} invited you to ${workspaceName}`
  const description = `Click the link below to sign in and join. This invitation expires after ${WORKSPACE_INVITATION_EXPIRY_HOURS} hours.`
  const content = renderTransactionalEmail({
    actionUrl,
    description,
    heading: `${inviterName} invited you to join the workspace ${workspaceName}`,
    kind: "invite",
    workspaceLogoUrl: input.workspaceLogoUrl,
    workspaceName,
  })

  return {
    from: formatSender(input.fromAddress),
    html: content.html,
    subject,
    tags: [{ name: "category", value: "workspace_invitation" }],
    text: content.text,
    to: [recipientEmail],
  }
}

export function createTeamRemovedEmailPayload(
  input: TeamRemovedEmailInput
): ResendEmailPayload {
  const workspaceName = requiredText(input.workspaceName)
  const removedMemberEmail = requiredEmail(input.removedMemberEmail)
  const subject = `You have been removed from ${workspaceName}`
  const content = renderTransactionalEmail({
    description: "Talk to your administrator if you think this was in error.",
    heading: `You've been removed from the ${workspaceName} workspace`,
    kind: "removed",
    workspaceLogoUrl: input.workspaceLogoUrl,
    workspaceName,
  })

  return {
    from: formatSender(input.fromAddress),
    html: content.html,
    subject,
    tags: [{ name: "category", value: "workspace_member_removed" }],
    text: content.text,
    to: [removedMemberEmail],
  }
}

export function createInviteAcceptedEmailPayload(
  input: InviteAcceptedEmailInput
): ResendEmailPayload {
  const inviterEmail = requiredEmail(input.inviterEmail)
  const memberName = requiredText(input.memberName)
  const workspaceName = requiredText(input.workspaceName)
  const subject = `${memberName} joined ${workspaceName}`
  const content = renderTransactionalEmail({
    description: "Your invite was accepted.",
    heading: `${memberName} has joined the workspace ${workspaceName}`,
    kind: "accepted",
    workspaceLogoUrl: input.workspaceLogoUrl,
    workspaceName,
  })

  return {
    from: formatSender(input.fromAddress),
    html: content.html,
    subject,
    tags: [{ name: "category", value: "workspace_invitation_accepted" }],
    text: content.text,
    // This confirmation belongs to the person who sent the invitation.
    to: [inviterEmail],
  }
}

export function renderTransactionalEmail(
  input:
    | (WorkspaceBrand & {
        actionUrl: string
        description: string
        heading: string
        kind: "invite"
      })
    | (WorkspaceBrand & {
        description: string
        heading: string
        kind: "accepted" | "removed"
      })
) {
  const workspaceName = requiredText(input.workspaceName)
  const heading = requiredText(input.heading)
  const description = requiredText(input.description)
  const kind = input.kind
  const button =
    kind === "invite"
      ? { href: requiredHttpsUrl(input.actionUrl), label: "Join workspace" }
      : undefined

  const shellInput: EmailShellInput = {
    button,
    description,
    heading,
    includeWorkspaceLogo: kind !== "accepted",
    preheader: description,
    subject: heading,
    workspaceLogoUrl: input.workspaceLogoUrl,
    workspaceName,
  }

  return {
    html: renderEmailShell(shellInput),
    text: renderPlainText(shellInput),
  }
}

function renderEmailShell(input: EmailShellInput) {
  const theme = MANDALA_MAGIC_LINK_EMAIL_THEME
  const light = theme.light
  const dark = theme.dark
  const heading = escapeHtml(input.heading)
  const description = escapeHtml(input.description)
  const button = input.button
    ? `<div style="margin-top:36px;">
                  <a class="mandala-email-button" href="${escapeAttribute(input.button.href)}" target="_blank" style="display:inline-block;background:${light.buttonBackground};border-radius:8px;color:${light.buttonText};font-family:${theme.fontFamily};font-size:14px;line-height:20px;font-weight:500;text-decoration:none;padding:10px 10px;">
                    <span style="display:inline-block;vertical-align:middle;">${escapeHtml(input.button.label)}</span>
                    <span aria-hidden="true" style="display:inline-block;width:16px;height:16px;margin-left:6px;vertical-align:-1px;font-size:14px;line-height:16px;text-align:center;">&#8599;</span>
                  </a>
                </div>`
    : ""
  const logo = input.includeWorkspaceLogo
    ? renderWorkspaceLogo(
        input.workspaceName,
        input.workspaceLogoUrl,
        light.iconUrl,
        dark.iconUrl
      )
    : ""

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${escapeHtml(input.subject)}</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      @media (prefers-color-scheme: dark) {
        .mandala-email-shell { background: ${dark.shellBackground} !important; }
        .mandala-email-heading { color: ${dark.text} !important; }
        .mandala-email-text, .mandala-email-footer-text { color: ${dark.mutedText} !important; }
        .mandala-email-divider { background: ${dark.border} !important; }
        .mandala-email-button { background: ${dark.buttonBackground} !important; color: ${dark.buttonText} !important; }
        .mandala-workspace-fallback-light { display:none !important;max-height:0 !important;overflow:hidden !important; }
        .mandala-workspace-fallback-dark { display:block !important;max-height:none !important;overflow:visible !important; }
      }
      @media only screen and (max-width: 620px) {
        .mandala-email-shell { width:100% !important; }
        .mandala-email-pad { padding-left:24px !important;padding-right:24px !important; }
        .mandala-email-footer { display:block !important; }
        .mandala-email-address { display:block !important;padding-top:16px !important;text-align:left !important; }
        .mandala-email-button { box-sizing:border-box !important;text-align:center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#ffffff;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:0;">
          <table class="mandala-email-shell" role="presentation" width="${theme.width}" height="${theme.height}" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:${theme.width}px;max-width:${theme.width}px;height:${theme.height}px;background:${light.shellBackground};">
            <tr>
              <td class="mandala-email-pad" valign="top" style="padding:64px 48px 0 48px;">
                ${logo}
                <h1 class="mandala-email-heading" style="margin:${logo ? "24px" : "64px"} 0 0 0;max-width:475px;color:${light.text};font-family:${theme.fontFamily};font-size:24px;line-height:30px;font-weight:500;letter-spacing:0;">${heading}</h1>
                <p class="mandala-email-text" style="margin:8px 0 0 0;width:401px;max-width:100%;color:${light.mutedText};font-family:${theme.fontFamily};font-size:16px;line-height:24px;font-weight:400;letter-spacing:0;">${description}</p>
                ${button}
              </td>
            </tr>
            <tr>
              <td class="mandala-email-pad" valign="bottom" style="padding:0 48px 64px 48px;">
                <div class="mandala-email-divider" style="height:1px;line-height:1px;background:${light.border};font-size:1px;">&nbsp;</div>
                <table class="mandala-email-footer" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:24px;">
                  <tr>
                    <td class="mandala-email-footer-text" valign="top" style="color:${light.mutedText};font-family:${theme.fontFamily};font-size:12px;line-height:16px;font-weight:400;">&copy; ${escapeHtml(theme.brandOwner)}</td>
                    <td class="mandala-email-address mandala-email-footer-text" valign="top" align="right" style="color:${light.mutedText};font-family:${theme.fontFamily};font-size:12px;line-height:16px;font-weight:400;text-align:right;">${theme.addressLines.map(escapeHtml).join("<br>")}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function renderWorkspaceLogo(
  workspaceName: string,
  workspaceLogoUrl: string | null | undefined,
  lightFallbackUrl: string,
  darkFallbackUrl: string
) {
  const safeLogoUrl = optionalHttpsUrl(workspaceLogoUrl)

  if (safeLogoUrl) {
    return `<img class="mandala-workspace-logo" src="${escapeAttribute(safeLogoUrl)}" width="48" height="48" alt="${escapeAttribute(workspaceName)} workspace logo" style="border:0;border-radius:999px;display:block;height:48px;object-fit:cover;outline:none;text-decoration:none;width:48px;">`
  }

  return [
    renderFallbackMark(
      lightFallbackUrl,
      "mandala-workspace-fallback-light",
      "block"
    ),
    renderFallbackMark(
      darkFallbackUrl,
      "mandala-workspace-fallback-dark",
      "none"
    ),
  ].join("\n                ")
}

function renderFallbackMark(
  src: string,
  className: string,
  display: "block" | "none"
) {
  const hiddenStyle = display === "none" ? "max-height:0;overflow:hidden;" : ""

  return `<img class="${className}" src="${escapeAttribute(src)}" width="48" height="48" alt="" aria-hidden="true" style="border:0;display:${display};height:48px;outline:none;text-decoration:none;width:48px;${hiddenStyle}">`
}

function renderPlainText(input: EmailShellInput) {
  const theme = MANDALA_MAGIC_LINK_EMAIL_THEME
  return [
    input.heading,
    "",
    input.description,
    ...(input.button ? ["", input.button.href] : []),
    "",
    theme.brandOwner,
    ...theme.addressLines,
  ].join("\n")
}

function requiredText(value: string) {
  const normalized = value?.trim()
  if (!normalized) throw new InvalidTransactionalEmailInputError()
  return normalized
}

function requiredEmail(value: string) {
  const normalized = requiredText(value)
  if (/\s|[<>]/.test(normalized) || !normalized.includes("@")) {
    throw new InvalidTransactionalEmailInputError()
  }
  return normalized
}

function requiredHttpsUrl(value: string) {
  const url = optionalHttpsUrl(value)
  if (!url) throw new InvalidTransactionalEmailInputError()
  return url
}

function optionalHttpsUrl(value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== "https:" || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
