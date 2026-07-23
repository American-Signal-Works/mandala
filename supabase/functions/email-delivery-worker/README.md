# Email delivery worker

This Edge Function processes the durable `email_deliveries` queue. It is not exposed to browser clients.

## Authentication boundary

`verify_jwt` is disabled because the database scheduler uses a dedicated bearer value. The function compares that bearer with `DELIVERY_WORKER_SECRET` in constant time before it claims any work.

## Edge Function secrets

- `DELIVERY_WORKER_SECRET`: at least 32 random bytes; must match the Vault scheduler secret.
- `EMAIL_PAYLOAD_RESOLVER_URL`: production `/api/internal/email/payload` URL.
- `EMAIL_PAYLOAD_RESOLVER_SECRET`: must match the server-side resolver secret.
- `RESEND_API_KEY`: production Resend API key.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: supplied by Supabase.

The signed `resend-delivery-webhook` function separately requires `RESEND_WEBHOOK_SECRET`.

## Scheduler Vault entries

- `email_delivery_worker_url`: the deployed Edge Function URL.
- `email_delivery_worker_secret`: the same value as `DELIVERY_WORKER_SECRET`.

The scheduled database function is a safe no-op unless both entries exist. Do not put values in migrations, logs, fixture files, or browser-visible variables.

## Local tests

Run the shared handler test without provider credentials:

```bash
deno test supabase/functions/email-delivery-worker/_shared/delivery.test.ts
```

Database retry and suppression behavior is covered by `supabase/tests/email_delivery_foundation_test.sql`; scheduler safety is covered by `supabase/tests/email_delivery_worker_schedule_test.sql`.
