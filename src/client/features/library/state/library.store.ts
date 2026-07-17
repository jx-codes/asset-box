import { observable } from "@legendapp/state"
import type { Asset } from "@/shared/domain"

export type AssetSelection = { tag: "none" } | { tag: "selected"; assetId: string }

export type TagFilter = { tag: "all" } | { tag: "tag"; slug: string }

export type AssetView = { tag: "active" } | { tag: "archived" }

export type AssetDialogState =
  | { tag: "closed" }
  | { tag: "editing-tags"; assetId: string; selectedSlugs: string[] }
  | { tag: "confirming-delete"; assetId: string }

export type TagManagerState =
  | { tag: "closed" }
  | { tag: "creating" }
  | { tag: "editing"; tagId: string }

export type LiveConnection = { tag: "connecting" } | { tag: "connected" } | { tag: "disconnected" }

export type AssetToast = { tag: "hidden" } | { tag: "new-asset"; asset: Asset }

export const library$ = observable({
  view: { tag: "active" } as AssetView,
  assetDialog: { tag: "closed" } as AssetDialogState,
  search: "",
  selection: { tag: "none" } as AssetSelection,
  tagFilter: { tag: "all" } as TagFilter,
  tagManager: { tag: "closed" } as TagManagerState,
  liveConnection: { tag: "connecting" } as LiveConnection,
  toast: { tag: "hidden" } as AssetToast,
})
