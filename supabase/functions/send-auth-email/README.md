# Mandala Auth Email Hook

This Supabase Edge Function sends Supabase Auth magic-link emails through Resend.

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

## Sender Profile Photo

Resend does not provide a per-message sender avatar field. The attached profile image should be used in the sender mailbox/provider setup, such as Gravatar for the exact from address or domain-level BIMI/Apple Branded Mail where available. The email body uses the Mandala mark from the Figma frame independently of inbox-avatar support.

## Theming

The email renderer keeps Mandala colors in `MANDALA_MAGIC_LINK_EMAIL_THEME`.
Light mode is the inline/default email-safe fallback, and clients that support
`prefers-color-scheme: dark` receive dark-mode overrides that match the Figma
email frame. Keep new color-bearing elements on `mandala-email-*` classes so
they can be targeted by the dark-mode CSS block.
