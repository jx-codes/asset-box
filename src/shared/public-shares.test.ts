import { describe, expect, it } from "vitest"
import {
  PublicShareCreateInputSchema,
  PublicShareCreatedSchema,
  PublicShareSchema,
} from "./public-shares"

const base = {
  id: "9a232244-4e6b-4592-ad15-6ca4e2a0e45f",
  assetId: "a".repeat(64),
  name: "Client review",
  prefix: "abp_abcdefgh",
  createdAt: "2026-07-18T10:00:00.000Z",
}

describe("public share contracts", () => {
  it("keeps active, expired, and revoked links structurally distinct", () => {
    const active = PublicShareSchema.safeParse({
      ...base,
      status: { tag: "active", expiration: { tag: "never" } },
      views: { tag: "never-viewed" },
      downloads: { tag: "never-downloaded" },
    })
    const revoked = PublicShareSchema.safeParse({
      ...base,
      status: { tag: "revoked", revokedAt: "2026-07-18T11:00:00.000Z" },
      views: { tag: "viewed", count: 2, lastViewedAt: "2026-07-18T10:30:00.000Z" },
      downloads: {
        tag: "downloaded",
        count: 1,
        lastDownloadedAt: "2026-07-18T10:45:00.000Z",
      },
    })

    expect(active.success).toBe(true)
    expect(revoked.success).toBe(true)
    expect(
      PublicShareSchema.safeParse({
        ...base,
        status: { tag: "expired" },
        views: { tag: "never-viewed" },
        downloads: { tag: "never-downloaded" },
      }).success,
    ).toBe(false)
  })

  it("returns a one-time public URL only from the creation contract", () => {
    const input = PublicShareCreateInputSchema.parse({ name: "Long-lived public asset" })
    const created = PublicShareCreatedSchema.safeParse({
      publicShare: {
        ...base,
        name: input.name,
        status: { tag: "active", expiration: { tag: "never" } },
        views: { tag: "never-viewed" },
        downloads: { tag: "never-downloaded" },
      },
      url: `https://asset-box.example.com/share/abp_${"a".repeat(43)}`,
    })

    expect(created.success).toBe(true)
    expect("url" in PublicShareSchema.shape).toBe(false)
  })
})
