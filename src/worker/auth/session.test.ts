import { describe, expect, it } from "vitest"
import { createSessionToken, verifySessionToken } from "./session"

const secret = "a-long-test-secret-that-is-not-used-in-production"

describe("session tokens", () => {
  it("accepts a signed, unexpired session", async () => {
    const issuedAt = new Date("2026-07-17T12:00:00.000Z")
    const token = await createSessionToken({ secret, now: issuedAt })
    if (token instanceof Error) throw token

    const verified = await verifySessionToken({
      token,
      secret,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })

    expect(verified).toBe(true)
  })

  it("rejects a token whose payload was changed", async () => {
    const token = await createSessionToken({ secret, now: new Date("2026-07-17T12:00:00.000Z") })
    if (token instanceof Error) throw token
    const [payload, signature] = token.split(".")

    const verified = await verifySessionToken({
      token: `${payload}x.${signature}`,
      secret,
      now: new Date("2026-07-18T12:00:00.000Z"),
    })

    expect(verified).toBe(false)
  })

  it("rejects a session after its thirty-day lifetime", async () => {
    const token = await createSessionToken({ secret, now: new Date("2026-07-01T00:00:00.000Z") })
    if (token instanceof Error) throw token

    const verified = await verifySessionToken({
      token,
      secret,
      now: new Date("2026-08-01T00:00:01.000Z"),
    })

    expect(verified).toBe(false)
  })
})
