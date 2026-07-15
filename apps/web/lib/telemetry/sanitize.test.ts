import { describe, expect, it } from "vitest"
import {
  sanitizeTelemetryEvent,
  sanitizeTelemetrySpan,
  sanitizeTelemetryText,
  stripUrlSecrets,
} from "./sanitize"

describe("telemetry sanitizer", () => {
  it("removes request credentials, bodies, query strings, and fragments", () => {
    const event = sanitizeTelemetryEvent({
      request: {
        body: { prompt: "private" },
        cookies: { session: "recognizable-cookie" },
        data: "recognizable-body",
        headers: { authorization: "Bearer recognizable-token" },
        url: "https://mandala.test/sign-up?invite=recognizable-token#private",
      },
      user: { email: "person@example.test", id: "user-safe" },
    })

    expect(event).toEqual({
      request: { url: "https://mandala.test/sign-up" },
      user: { id: "user-safe" },
    })
  })

  it("recursively removes sensitive extras and redacts secrets in messages", () => {
    const event = sanitizeTelemetryEvent({
      breadcrumbs: [
        {
          data: {
            authorization: "Bearer recognizable-token",
            url: "/callback?token_hash=recognizable-token#private",
          },
          message:
            "Failed for person@example.test with token=recognizable-token",
        },
      ],
      contexts: {
        unsafe: { refresh_token: "recognizable-refresh-token" },
      },
      extra: {
        nested: {
          body: "recognizable-body",
          cookie: "recognizable-cookie",
        },
      },
    })

    const emitted = JSON.stringify(event)
    expect(emitted).not.toContain("recognizable-token")
    expect(emitted).not.toContain("recognizable-refresh-token")
    expect(emitted).not.toContain("recognizable-cookie")
    expect(emitted).not.toContain("recognizable-body")
    expect(emitted).not.toContain("person@example.test")
    expect(event.breadcrumbs[0]?.data).toEqual({ url: "/callback" })
  })

  it("scrubs standalone text and both URL secret sections", () => {
    expect(
      sanitizeTelemetryText(
        "Bearer abc person@example.test https://mandala.test/path?code=abc#hash"
      )
    ).toBe("Bearer [redacted] [redacted] https://mandala.test/path")
    expect(stripUrlSecrets("/path#secret")).toBe("/path")
  })

  it("scrubs transaction and span trace payloads", () => {
    const transaction = sanitizeTelemetryEvent({
      transaction: "/invitation?token=recognizable-invite#private",
      request: {
        headers: { cookie: "recognizable-cookie" },
        url: "https://mandala.test/callback?code=recognizable-code#private",
      },
      spans: [
        {
          description:
            "GET /callback?code=recognizable-code person@example.test",
          data: {
            authorization: "Bearer recognizable-bearer",
            url: "/invitation?token=recognizable-invite",
          },
        },
      ],
    })
    const span = sanitizeTelemetrySpan({
      description: "/callback?token_hash=recognizable-hash#private",
      data: {
        body: "recognizable-body",
        email: "person@example.test",
        url: "https://mandala.test/invitation?token=recognizable-invite",
      },
    })

    const emitted = JSON.stringify({ transaction, span })
    expect(emitted).not.toContain("recognizable-")
    expect(emitted).not.toContain("person@example.test")
    expect(transaction.transaction).toBe("/invitation")
    expect(transaction.request).toEqual({
      url: "https://mandala.test/callback",
    })
    expect(span.description).toBe("/callback")
  })
})
