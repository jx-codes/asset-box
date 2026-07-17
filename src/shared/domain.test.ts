import { describe, expect, it } from "vitest"
import { AssetSchema, LibraryViewSchema } from "./domain"

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
