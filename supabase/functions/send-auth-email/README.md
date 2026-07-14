# Mandala Auth Email Hook

This Supabase Edge Function sends supported Supabase Auth emails through Resend.
It currently accepts magic-link (`magiclink`, new-user `signup`, and the legacy
`email` alias) and password-recovery (`recovery`) hook actions. Other action
types fail closed until their own copy and behavior are explicitly implemented.

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
