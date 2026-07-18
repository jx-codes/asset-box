import { beforeEach, describe, expect, it } from "vitest"
import type { Asset } from "@/shared/domain"
import {
  clearDeletedAssetSelection,
  filterByTag,
  openAssetTagEditor,
  openPublicShareManager,
  selectAsset,
  showArchivedAssets,
  toggleAssetTag,
} from "./library.actions"
import { library$ } from "./library.store"

const asset: Asset = {
  id: "a".repeat(64),
  title: "Architecture guide",
  blurb: "A visual guide to the service.",
  sizeBytes: 2048,
  createdAt: "2026-07-17T12:00:00.000Z",
  lifecycle: { tag: "active" },
  tags: [
    {
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
      name: "Research",
      slug: "research",
      guidance: "Use for research outputs.",
      createdAt: "2026-07-17T12:00:00.000Z",
    },
  ],
}

describe("library actions", () => {
  beforeEach(() => {
    library$.view.set({ tag: "active" })
    library$.selection.set({ tag: "none" })
    library$.tagFilter.set({ tag: "all" })
    library$.assetDialog.set({ tag: "closed" })
  })

  it("switches to archived assets and clears incompatible selection and filters", () => {
    filterByTag("research")
    selectAsset(asset.id)

    showArchivedAssets()

    expect(library$.view.peek()).toEqual({ tag: "archived" })
    expect(library$.selection.peek()).toEqual({ tag: "none" })
    expect(library$.tagFilter.peek()).toEqual({ tag: "all" })
  })

  it("opens tag editing with the canonical assigned slugs and toggles membership", () => {
    openAssetTagEditor(asset)
    toggleAssetTag("research")
    toggleAssetTag("jmcodes")

    expect(library$.assetDialog.peek()).toEqual({
      tag: "editing-tags",
      assetId: asset.id,
      selectedSlugs: ["jmcodes"],
    })
  })

  it("opens public sharing for the selected canonical asset", () => {
    selectAsset(asset.id)
    openPublicShareManager(asset.id)

    expect(library$.assetDialog.peek()).toEqual({ tag: "sharing", assetId: asset.id })
  })

  it("clears selection and dialog state after a remote delete event", () => {
    selectAsset(asset.id)
    openAssetTagEditor(asset)

    clearDeletedAssetSelection(asset.id)

    expect(library$.selection.peek()).toEqual({ tag: "none" })
    expect(library$.assetDialog.peek()).toEqual({ tag: "closed" })
  })
})
