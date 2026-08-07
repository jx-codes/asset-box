import { describe, expect, it } from "vitest"
import {
  createAssetPreviewToken,
  createSessionToken,
  verifyAssetPreviewToken,
  verifySessionToken,
} from "./session"

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

describe("asset preview tokens", () => {
  const assetId = "a".repeat(64)

  it("authorizes nested requests only for the asset that established the preview", async () => {
    const issuedAt = new Date("2026-08-07T12:00:00.000Z")
    const token = await createAssetPreviewToken({ assetId, secret, now: issuedAt })
    if (token instanceof Error) throw token

    const matchingAsset = await verifyAssetPreviewToken({
      token,
      assetId,
      secret,
      now: new Date("2026-08-07T12:30:00.000Z"),
    })
    const differentAsset = await verifyAssetPreviewToken({
      token,
      assetId: "b".repeat(64),
      secret,
      now: new Date("2026-08-07T12:30:00.000Z"),
    })

    expect(matchingAsset).toBe(true)
    expect(differentAsset).toBe(false)
  })

  it("expires the nested-preview capability after one hour", async () => {
    const issuedAt = new Date("2026-08-07T12:00:00.000Z")
    const token = await createAssetPreviewToken({ assetId, secret, now: issuedAt })
    if (token instanceof Error) throw token

    const verified = await verifyAssetPreviewToken({
      token,
      assetId,
      secret,
      now: new Date("2026-08-07T13:00:01.000Z"),
    })

    expect(verified).toBe(false)
  })
})
