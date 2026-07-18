import { workRequestPanel$ } from "./work-request.store"

export function openAssetWorkRequest(assetId: string) {
  workRequestPanel$.state.set({ tag: "asset", assetId, draftBody: "" })
}

export function openNewAssetRequest() {
  workRequestPanel$.state.set({
    tag: "new-asset",
    mode: "creating",
    title: "",
    blurb: "",
    draftBody: "",
  })
}

export function showLatestNewAssetRequest() {
  const state = workRequestPanel$.state.peek()
  if (state.tag !== "new-asset") return
  workRequestPanel$.state.set({ ...state, mode: "latest", title: "", blurb: "" })
}

export function closeWorkRequestPanel() {
  workRequestPanel$.state.set({ tag: "closed" })
}

export function changeWorkRequestDraft(draftBody: string) {
  const state = workRequestPanel$.state.peek()
  if (state.tag === "closed") return
  workRequestPanel$.state.set({ ...state, draftBody })
}

export function clearWorkRequestDraft() {
  changeWorkRequestDraft("")
}

export function changeNewAssetTitle(title: string) {
  const state = workRequestPanel$.state.peek()
  if (state.tag !== "new-asset") return
  workRequestPanel$.state.set({ ...state, title })
}

export function changeNewAssetBlurb(blurb: string) {
  const state = workRequestPanel$.state.peek()
  if (state.tag !== "new-asset") return
  workRequestPanel$.state.set({ ...state, blurb })
}
