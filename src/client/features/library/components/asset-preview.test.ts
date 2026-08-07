import { describe, expect, it } from "vitest"
import { assetViewHref } from "./asset-preview"

describe("asset preview entry URL", () => {
  it("uses the cache-busting route that establishes a path capability", () => {
    const assetId = "a".repeat(64)

    expect(assetViewHref(assetId)).toBe(`/view/${assetId}?preview=path-capability-v1`)
  })
})
