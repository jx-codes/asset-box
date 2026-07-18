import { beforeEach, describe, expect, it } from "vitest"
import {
  changeNewAssetBlurb,
  changeNewAssetTitle,
  changeWorkRequestDraft,
  clearWorkRequestDraft,
  openAssetWorkRequest,
  openNewAssetRequest,
  showLatestNewAssetRequest,
} from "./work-request.actions"
import { workRequestPanel$ } from "./work-request.store"

describe("work request panel actions", () => {
  beforeEach(() => workRequestPanel$.state.set({ tag: "closed" }))

  it("keeps an asset draft owned by the selected request panel", () => {
    openAssetWorkRequest("a".repeat(64))
    changeWorkRequestDraft("Increase the heading contrast.")

    expect(workRequestPanel$.state.peek()).toEqual({
      tag: "asset",
      assetId: "a".repeat(64),
      draftBody: "Increase the heading contrast.",
    })

    clearWorkRequestDraft()
    expect(workRequestPanel$.state.peek()).toMatchObject({ draftBody: "" })
  })

  it("moves a new-asset panel from metadata creation to the durable latest request", () => {
    openNewAssetRequest()
    changeNewAssetTitle("Architecture diagram")
    changeNewAssetBlurb("A diagram of the request lifecycle.")
    showLatestNewAssetRequest()

    expect(workRequestPanel$.state.peek()).toEqual({
      tag: "new-asset",
      mode: "latest",
      title: "",
      blurb: "",
      draftBody: "",
    })
  })
})
