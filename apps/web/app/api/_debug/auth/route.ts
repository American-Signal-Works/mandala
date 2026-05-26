// TEMPORARY DEBUG ENDPOINT — delete after diagnosing magic-link redirect issue.
// Returns what the server thinks the origin is, so we can verify getOrigin()
// is computing the correct URL on Vercel.
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const proto = h.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET() {
  const h = await headers();
  const origin = await getOrigin();
  return NextResponse.json({
    computed: {
      origin,
      emailRedirectTo: `${origin}/callback`,
    },
    env: {
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? null,
      VERCEL_URL: process.env.VERCEL_URL ?? null,
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    },
    headers: {
      host: h.get("host"),
      "x-forwarded-host": h.get("x-forwarded-host"),
      "x-forwarded-proto": h.get("x-forwarded-proto"),
    },
  });
}
