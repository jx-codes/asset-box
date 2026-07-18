import { describe, expect, it } from "vitest"
import {
  AssetSchema,
  LibraryViewSchema,
  ServiceTokenCreatedSchema,
  ServiceTokenInputSchema,
  ServiceTokenSchema,
} from "./domain"

const baseAsset = {
  id: "a".repeat(64),
  title: "Architecture guide",
  blurb: "A visual guide to the service.",
  sizeBytes: 2048,
  createdAt: "2026-07-17T12:00:00.000Z",
  tags: [],
}

describe("asset lifecycle", () => {
  it("parses active assets without an archive timestamp", () => {
    const asset = AssetSchema.parse({ ...baseAsset, lifecycle: { tag: "active" } })

    expect(asset.lifecycle).toEqual({ tag: "active" })
  })

  it("requires an ISO timestamp for archived assets", () => {
    const missingTimestamp = AssetSchema.safeParse({
      ...baseAsset,
      lifecycle: { tag: "archived" },
    })
    const validArchive = AssetSchema.safeParse({
      ...baseAsset,
      lifecycle: { tag: "archived", archivedAt: "2026-07-17T13:00:00.000Z" },
    })

    expect(missingTimestamp.success).toBe(false)
    expect(validArchive.success).toBe(true)
  })

  it("only accepts observable library views", () => {
    expect(LibraryViewSchema.safeParse("active").success).toBe(true)
    expect(LibraryViewSchema.safeParse("archived").success).toBe(true)
    expect(LibraryViewSchema.safeParse("deleted").success).toBe(false)
  })
})

describe("service token contracts", () => {
  const baseToken = {
    id: "7a4d4991-42a7-4804-8cf7-bb7a625c51a9",
    name: "Local CLI",
    prefix: "abx_abcdefgh",
    createdAt: "2026-07-17T12:00:00.000Z",
    usage: { tag: "never-used" },
  }

  it("keeps absence and lifecycle states explicit in metadata", () => {
    const active = ServiceTokenSchema.parse({
      ...baseToken,
      status: { tag: "active", expiration: { tag: "never" } },
    })
    const used = ServiceTokenSchema.parse({
      ...baseToken,
      usage: { tag: "used", lastUsedAt: "2026-07-17T13:00:00.000Z" },
      status: {
        tag: "active",
        expiration: {
          tag: "scheduled",
          expiresAt: "2026-08-17T12:00:00.000Z",
        },
      },
    })

    expect(active.usage).toEqual({ tag: "never-used" })
    expect(active.status).toEqual({ tag: "active", expiration: { tag: "never" } })
    expect(used.usage.tag).toBe("used")
  })

  it("rejects lifecycle fields that do not belong to the selected status", () => {
    const missingExpiration = ServiceTokenSchema.safeParse({
      ...baseToken,
      status: { tag: "active", expiration: { tag: "scheduled" } },
    })
    const missingRevocation = ServiceTokenSchema.safeParse({
      ...baseToken,
      status: { tag: "revoked" },
    })

    expect(missingExpiration.success).toBe(false)
    expect(missingRevocation.success).toBe(false)
  })

  it("accepts plaintext only in the one-time creation contract", () => {
    const metadata = ServiceTokenSchema.parse({
      ...baseToken,
      status: { tag: "active", expiration: { tag: "never" } },
    })
    const created = ServiceTokenCreatedSchema.parse({
      serviceToken: metadata,
      token: `abx_${"a".repeat(43)}`,
    })

    expect(created.token).toMatch(/^abx_/)
    expect("token" in created.serviceToken).toBe(false)
  })

  it("accepts an optional ISO expiration at the creation boundary", () => {
    expect(ServiceTokenInputSchema.safeParse({ name: "No expiry" }).success).toBe(true)
    expect(
      ServiceTokenInputSchema.safeParse({
        name: "Expiring token",
        expiresAt: "2026-08-17T12:00:00.000Z",
      }).success,
    ).toBe(true)
    expect(
      ServiceTokenInputSchema.safeParse({ name: "Bad expiry", expiresAt: "tomorrow" }).success,
    ).toBe(false)
  })
})
