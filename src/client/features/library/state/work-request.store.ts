import { observable } from "@legendapp/state"

export type WorkRequestPanelState =
  | { tag: "closed" }
  | { tag: "requests" }
  | { tag: "asset"; assetId: string; draftBody: string }
  | {
      tag: "new-asset"
      mode: "creating" | "latest"
      title: string
      blurb: string
      draftBody: string
    }

export const workRequestPanel$ = observable({
  state: { tag: "closed" } as WorkRequestPanelState,
})
