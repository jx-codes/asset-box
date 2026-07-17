import { test } from "@fast-check/vitest"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { Asset, Tag } from "@/shared/domain"
import { filterAssets } from "./filter-assets"

const demoTag: Tag = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Landing page",
  slug: "landing-page",
  guidance: "Use for finished product landing pages.",
  createdAt: "2026-07-17T12:00:00.000Z",
}

const assets: Asset[] = [
  {
    id: "a".repeat(64),
    title: "Launch page",
    blurb: "A polished release page",
    sizeBytes: 1024,
    createdAt: "2026-07-17T12:00:00.000Z",
    lifecycle: { tag: "active" },
    tags: [demoTag],
  },
  {
    id: "b".repeat(64),
    title: "Status display",
    blurb: "An operational summary",
    sizeBytes: 2048,
    createdAt: "2026-07-16T12:00:00.000Z",
    lifecycle: { tag: "active" },
    tags: [],
  },
]

describe("filterAssets", () => {
  it("searches asset metadata and tag guidance", () => {
    const byTitle = filterAssets({ assets, search: "launch", tagFilter: { tag: "all" } })
    const byGuidance = filterAssets({ assets, search: "product", tagFilter: { tag: "all" } })

    expect(byTitle.map((asset) => asset.id)).toEqual(["a".repeat(64)])
    expect(byGuidance.map((asset) => asset.id)).toEqual(["a".repeat(64)])
  })

  it("only returns assets carrying the selected tag", () => {
    const result = filterAssets({
      assets,
      search: "",
      tagFilter: { tag: "tag", slug: "landing-page" },
    })

    expect(result).toEqual([assets[0]])
  })

  test.prop([fc.array(fc.string())])(
    "preserves every item and its order for an empty search",
    (titles) => {
      const generated = titles.map(
        (title, index): Asset => ({
          id: index.toString(16).padStart(64, "0"),
          title,
          blurb: "",
          sizeBytes: 0,
          createdAt: "2026-07-17T12:00:00.000Z",
          lifecycle: { tag: "active" },
          tags: [],
        }),
      )

      const result = filterAssets({ assets: generated, search: "", tagFilter: { tag: "all" } })

      expect(result).toEqual(generated)
    },
  )
})
