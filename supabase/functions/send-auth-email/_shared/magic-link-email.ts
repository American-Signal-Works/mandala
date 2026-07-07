export const MAGIC_LINK_EMAIL_SUBJECT = "Sign in with magic link"
export const MAGIC_LINK_SENDER_NAME = "Mandala"
export const MAGIC_LINK_EXPIRY_MINUTES = 5

const MANDALA_ICON_ASSET_REVISION =
  "b8d27daac8f84123eb589cc6b4d6da4f8546b2e3"
const MANDALA_ICON_ASSET_BASE_URL = `https://raw.githubusercontent.com/American-Signal-Works/mandala/${MANDALA_ICON_ASSET_REVISION}/apps/web/public`

type MagicLinkEmailPalette = {
  background: string
  shellBackground: string
  text: string
  mutedText: string
  border: string
  buttonBackground: string
  buttonText: string
  iconUrl: string
}

type MagicLinkEmailTheme = {
  addressLines: [string, string]
  brandOwner: string
  fontFamily: string
  height: number
  width: number
  light: MagicLinkEmailPalette
  dark: MagicLinkEmailPalette
}

export const MANDALA_MAGIC_LINK_EMAIL_THEME: MagicLinkEmailTheme = {
  addressLines: ["30 North Gould Suite N", "Sheridan, WY"],
  brandOwner: "American Signal Works",
  fontFamily:
    "Figtree, Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  height: 650,
  width: 600,
  light: {
    background: "#f4f1eb",
    shellBackground: "#ffffff",
    text: "#171717",
    mutedText: "#6d6a63",
    border: "#ded8cf",
    buttonBackground: "#3376f7",
    buttonText: "#ffffff",
    iconUrl: `${MANDALA_ICON_ASSET_BASE_URL}/auth-icon-light.png`,
  },
  dark: {
    background: "#111111",
    shellBackground: "#111111",
    text: "#f0ece6",
    mutedText: "#a4a3a0",
    border: "#202123",
    buttonBackground: "#3376f7",
    buttonText: "#ffffff",
    iconUrl: `${MANDALA_ICON_ASSET_BASE_URL}/auth-icon-dark.png`,
  },
}

const REQUIRED_ENV_VARS = [
  "RESEND_API_KEY",
  "RESEND_AUTH_EMAIL_FROM_ADDRESS",
  "SEND_EMAIL_HOOK_SECRET",
  "SUPABASE_URL",
] as const

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number]

export type EnvGetter = (name: string) => string | undefined

export type SendAuthEmailConfig = {
  fromAddress: string
  hookSecret: string
  resendApiKey: string
  supabaseUrl: string
}

export type SupabaseAuthEmailHookPayload = {
  user?: {
    email?: string | null
  } | null
  email_data?: {
    email_action_type?: string | null
    redirect_to?: string | null
    token?: string | null
    token_hash?: string | null
    token_hash_new?: string | null
  } | null
}

export type ResendEmailPayload = {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  tags: Array<{
    name: string
    value: string
  }>
}

type VerifyWebhook = (
  payload: string,
  headers: Record<string, string>,
  secret: string
) => unknown

type SendEmail = (
  payload: ResendEmailPayload,
  config: SendAuthEmailConfig
) => Promise<{ error?: unknown } | void>

export type SendAuthEmailDependencies = {
  getEnv: EnvGetter
  sendEmail: SendEmail
  verifyWebhook: VerifyWebhook
}

export class MissingEmailHookConfigError extends Error {
  constructor(public readonly missing: RequiredEnvVar[]) {
    super("Email hook configuration is missing.")
    this.name = "MissingEmailHookConfigError"
  }
}

export class InvalidEmailHookPayloadError extends Error {
  constructor() {
    super("Email hook payload is invalid.")
    this.name = "InvalidEmailHookPayloadError"
  }
}

export function getSendAuthEmailConfig(getEnv: EnvGetter): SendAuthEmailConfig {
  const values = Object.fromEntries(
    REQUIRED_ENV_VARS.map((name) => [name, getEnv(name)?.trim() ?? ""])
  ) as Record<RequiredEnvVar, string>
  const missing = REQUIRED_ENV_VARS.filter((name) => !values[name])

  if (missing.length > 0) {
    throw new MissingEmailHookConfigError(missing)
  }

  return {
    fromAddress: values.RESEND_AUTH_EMAIL_FROM_ADDRESS,
    hookSecret: values.SEND_EMAIL_HOOK_SECRET,
    resendApiKey: values.RESEND_API_KEY,
    supabaseUrl: values.SUPABASE_URL,
  }
}

export function normalizeWebhookSecret(secret: string) {
  return secret.trim().replace(/^v1,whsec_/, "")
}

export function createResendEmailPayload(
  hookPayload: SupabaseAuthEmailHookPayload,
  config: SendAuthEmailConfig
): ResendEmailPayload {
  const recipient = hookPayload.user?.email?.trim()
  const emailData = hookPayload.email_data
  const tokenHash = (
    emailData?.token_hash ||
    emailData?.token_hash_new ||
    ""
  ).trim()
  const emailActionType = emailData?.email_action_type?.trim()
  const redirectTo = emailData?.redirect_to?.trim()

  if (!recipient || !tokenHash || !emailActionType || !redirectTo) {
    throw new InvalidEmailHookPayloadError()
  }

  const magicLink = buildSupabaseVerifyUrl({
    emailActionType,
    redirectTo,
    supabaseUrl: config.supabaseUrl,
    tokenHash,
  })

  return {
    from: formatSender(config.fromAddress),
    html: renderMandalaMagicLinkHtml(magicLink),
    subject: MAGIC_LINK_EMAIL_SUBJECT,
    tags: [{ name: "category", value: "auth_magic_link" }],
    text: renderMandalaMagicLinkText(magicLink),
    to: [recipient],
  }
}

export function buildSupabaseVerifyUrl({
  emailActionType,
  redirectTo,
  supabaseUrl,
  tokenHash,
}: {
  emailActionType: string
  redirectTo: string
  supabaseUrl: string
  tokenHash: string
}) {
  const url = new URL("/auth/v1/verify", supabaseUrl.replace(/\/+$/, ""))
  url.searchParams.set("token", tokenHash)
  url.searchParams.set("type", emailActionType)
  url.searchParams.set("redirect_to", redirectTo)
  return url.toString()
}

export function formatSender(fromAddress: string) {
  const address = fromAddress.trim()

  if (!address || address.includes("<") || address.includes(">")) {
    throw new InvalidEmailHookPayloadError()
  }

  return `${MAGIC_LINK_SENDER_NAME} <${address}>`
}

export async function handleSendAuthEmailRequest(
  request: Request,
  dependencies: SendAuthEmailDependencies
) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405)
  }

  let config: SendAuthEmailConfig
  try {
    config = getSendAuthEmailConfig(dependencies.getEnv)
  } catch (error) {
    if (error instanceof MissingEmailHookConfigError) {
      return jsonResponse({ error: "Email hook is not configured." }, 500)
    }
    return jsonResponse({ error: "Email hook setup failed." }, 500)
  }

  const payload = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  let hookPayload: SupabaseAuthEmailHookPayload
  try {
    hookPayload = dependencies.verifyWebhook(
      payload,
      headers,
      config.hookSecret
    ) as SupabaseAuthEmailHookPayload
  } catch {
    return jsonResponse({ error: "Invalid email hook signature." }, 401)
  }

  let emailPayload: ResendEmailPayload
  try {
    emailPayload = createResendEmailPayload(hookPayload, config)
  } catch {
    return jsonResponse({ error: "Invalid email hook payload." }, 400)
  }

  try {
    const result = await dependencies.sendEmail(emailPayload, config)
    if (result && "error" in result && result.error) {
      return jsonResponse({ error: "Email provider failed to send." }, 502)
    }
  } catch {
    return jsonResponse({ error: "Email provider failed to send." }, 502)
  }

  return jsonResponse({}, 200)
}

export function renderMandalaMagicLinkHtml(magicLink: string) {
  const href = escapeAttribute(magicLink)
  const theme = MANDALA_MAGIC_LINK_EMAIL_THEME
  const light = theme.light
  const dark = theme.dark

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>${MAGIC_LINK_EMAIL_SUBJECT}</title>
    <style>
      :root {
        color-scheme: light dark;
        supported-color-schemes: light dark;
      }
      @media (prefers-color-scheme: dark) {
        .mandala-email-shell {
          background: ${dark.shellBackground} !important;
        }
        .mandala-email-heading {
          color: ${dark.text} !important;
        }
        .mandala-email-text,
        .mandala-email-footer-text {
          color: ${dark.mutedText} !important;
        }
        .mandala-email-divider {
          background: ${dark.border} !important;
        }
        .mandala-email-button {
          background: ${dark.buttonBackground} !important;
          color: ${dark.buttonText} !important;
        }
        .mandala-email-mark-light {
          display: none !important;
          max-height: 0 !important;
          overflow: hidden !important;
        }
        .mandala-email-mark-dark {
          display: block !important;
          max-height: none !important;
          overflow: visible !important;
        }
      }
      @media only screen and (max-width: 620px) {
        .mandala-email-shell { width: 100% !important; }
        .mandala-email-pad { padding-left: 24px !important; padding-right: 24px !important; }
        .mandala-email-footer { display: block !important; }
        .mandala-email-address { display: block !important; padding-top: 16px !important; text-align: left !important; }
      }
    </style>
  </head>
  <body class="mandala-email-body" style="margin:0;padding:0;background:#ffffff;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Click the link below to sign in. After ${MAGIC_LINK_EXPIRY_MINUTES} minutes you will need to request a new one.
    </div>
    <table class="mandala-email-root" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#ffffff;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:0;">
          <table class="mandala-email-shell" role="presentation" width="${theme.width}" height="${theme.height}" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:${theme.width}px;max-width:${theme.width}px;height:${theme.height}px;background:${light.shellBackground};">
            <tr>
              <td class="mandala-email-pad" valign="top" style="padding:64px 48px 0 48px;">
                ${renderMandalaMarkImage(light.iconUrl, "mandala-email-mark-light", "block")}
                ${renderMandalaMarkImage(dark.iconUrl, "mandala-email-mark-dark", "none")}
                <h1 class="mandala-email-heading" style="margin:24px 0 0 0;color:${light.text};font-family:${theme.fontFamily};font-size:24px;line-height:24px;font-weight:500;letter-spacing:0;">
                  Here&rsquo;s your magic link
                </h1>
                <p class="mandala-email-text" style="margin:8px 0 0 0;width:401px;max-width:100%;color:${light.mutedText};font-family:${theme.fontFamily};font-size:16px;line-height:24px;font-weight:400;letter-spacing:0;">
                  Click the link below to sign in. After ${MAGIC_LINK_EXPIRY_MINUTES} minutes you will need to request a new one.
                </p>
                <div style="margin-top:36px;">
                  <a class="mandala-email-button" href="${href}" target="_blank" style="display:inline-block;background:${light.buttonBackground};border-radius:8px;color:${light.buttonText};font-family:${theme.fontFamily};font-size:14px;line-height:20px;font-weight:500;text-decoration:none;padding:10px 10px;">
                    <span style="display:inline-block;vertical-align:middle;">Sign in</span>
                    <span aria-hidden="true" style="display:inline-block;width:16px;height:16px;margin-left:6px;vertical-align:-1px;font-size:14px;line-height:16px;text-align:center;">${ARROW_UP_RIGHT_ENTITY}</span>
                  </a>
                </div>
              </td>
            </tr>
            <tr>
              <td class="mandala-email-pad" valign="bottom" style="padding:0 48px 64px 48px;">
                <div class="mandala-email-divider" style="height:1px;line-height:1px;background:${light.border};font-size:1px;">&nbsp;</div>
                <table class="mandala-email-footer" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin-top:24px;">
                  <tr>
                    <td class="mandala-email-footer-text" valign="top" style="color:${light.mutedText};font-family:${theme.fontFamily};font-size:12px;line-height:16px;font-weight:400;">
                      &copy; ${theme.brandOwner}
                    </td>
                    <td class="mandala-email-address mandala-email-footer-text" valign="top" align="right" style="color:${light.mutedText};font-family:${theme.fontFamily};font-size:12px;line-height:16px;font-weight:400;text-align:right;">
                      ${theme.addressLines.map(escapeHtml).join("<br>")}
                    </td>
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

export function renderMandalaMagicLinkText(magicLink: string) {
  const theme = MANDALA_MAGIC_LINK_EMAIL_THEME

  return [
    "Here's your magic link",
    "",
    `Click the link below to sign in. After ${MAGIC_LINK_EXPIRY_MINUTES} minutes you will need to request a new one.`,
    "",
    magicLink,
    "",
    theme.brandOwner,
    ...theme.addressLines,
  ].join("\n")
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function renderMandalaMarkImage(
  src: string,
  className: string,
  display: "block" | "none"
) {
  const hiddenStyle =
    display === "none" ? "max-height:0;overflow:hidden;" : ""

  return `<img class="${className}" src="${escapeAttribute(src)}" width="36" height="36" alt="" aria-hidden="true" style="border:0;display:${display};height:36px;outline:none;text-decoration:none;width:36px;${hiddenStyle}">`
}

const ARROW_UP_RIGHT_ENTITY = "&#8599;"
