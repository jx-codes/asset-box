import type { Asset } from "@/shared/domain"
import { library$ } from "./library.store"

export function changeSearch(search: string) {
  library$.search.set(search)
}

export function selectAsset(assetId: string) {
  library$.selection.set({ tag: "selected", assetId })
}

export function clearAssetSelection() {
  library$.selection.set({ tag: "none" })
}

export function filterByTag(slug: string) {
  library$.tagFilter.set({ tag: "tag", slug })
  library$.selection.set({ tag: "none" })
}

export function clearTagFilter() {
  library$.tagFilter.set({ tag: "all" })
}

export function openTagCreator() {
  library$.tagManager.set({ tag: "creating" })
}

export function openTagEditor(tagId: string) {
  library$.tagManager.set({ tag: "editing", tagId })
}

export function closeTagManager() {
  library$.tagManager.set({ tag: "closed" })
}

export function markLiveConnected() {
  library$.liveConnection.set({ tag: "connected" })
}

export function markLiveDisconnected() {
  library$.liveConnection.set({ tag: "disconnected" })
}

export function showNewAsset(asset: Asset) {
  library$.toast.set({ tag: "new-asset", asset })
}

export function hideAssetToast() {
  library$.toast.set({ tag: "hidden" })
}
