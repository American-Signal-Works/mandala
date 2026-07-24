# Mandala Auth Email Hook

This Supabase Edge Function sends supported Supabase Auth emails through Resend
and records them in Mandala's durable email-delivery ledger.
It currently accepts magic-link (`magiclink`, new-user `signup`, and the legacy
`email` alias) and password-recovery (`recovery`) hook actions. Other action
types fail closed until their own copy and behavior are explicitly implemented.

Authentication links are intentionally different from regeneratable workspace
invitation payloads. The verified Auth hook renders and sends the link while it
exists only in Edge Function memory. The database stores an opaque hook
reference, recipient delivery metadata, attempts, provider ID, and webhook
transitions; it never stores the one-time token, token hash, verification URL,
rendered HTML/text, or raw signed hook body.

The hook makes up to three bounded inline attempts within Supabase's HTTP hook
time limit. Every attempt is recorded, all provider calls use the logical
delivery's stable Resend idempotency key, and the final transient failure becomes
a safe terminal ledger state. The scheduled invitation worker never claims
`inline_auth` rows because their token-bearing payload cannot be regenerated.

The shared renderer folder also contains transport-ready contracts for workspace
invitations, member-removal notices, and invitation-accepted confirmations. Their
live invitation and membership triggers intentionally remain in the later
invitation workflow.

## Required Secrets

Set these in the Supabase project that hosts the function:

```sh
supabase secrets set \
  RESEND_API_KEY="re_..." \
  SEND_EMAIL_HOOK_SECRET="v1,whsec_..." \
  RESEND_AUTH_EMAIL_FROM_ADDRESS="auth@example.com"
```

`SUPABASE_URL` is supplied by Supabase Edge Functions. The sender display name is hard-coded as `Mandala`, so Resend receives:

`SUPABASE_SERVICE_ROLE_KEY` is also supplied by the hosted Edge Function
environment. It is used only server-side for the service-role-only enqueue,
claim, and result RPCs; never add it to browser configuration or logs.

```txt
Mandala <auth@example.com>
```

## Deploy

```sh
supabase functions deploy send-auth-email --no-verify-jwt
```

Then configure the Supabase Auth Send Email Hook to call:

```txt
https://<project-ref>.supabase.co/functions/v1/send-auth-email
```

Use the same `SEND_EMAIL_HOOK_SECRET` value as the hook secret.

## Workspace Logo

Resend does not provide a per-message sender avatar field. The attached profile image should be used in the sender mailbox/provider setup, such as Gravatar for the exact from address or domain-level BIMI/Apple Branded Mail where available. The email body uses the Mandala mark from the Figma frame independently of inbox-avatar support.

The image shown inside invitation and member-removal emails is the workspace
logo, never the inviter's avatar. Renderers accept only HTTPS logo URLs and fall
back to the Mandala mark while keeping the workspace name in readable text.

## Theming

The email renderer keeps Mandala colors in `MANDALA_MAGIC_LINK_EMAIL_THEME`.
Light mode is the inline/default email-safe fallback, and clients that support
`prefers-color-scheme: dark` receive dark-mode overrides that match the Figma
email frame. Keep new color-bearing elements on `mandala-email-*` classes so
they can be targeted by the dark-mode CSS block.
