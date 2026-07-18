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

export function showActiveAssets() {
  library$.view.set({ tag: "active" })
  library$.selection.set({ tag: "none" })
  library$.tagFilter.set({ tag: "all" })
}

export function showArchivedAssets() {
  library$.view.set({ tag: "archived" })
  library$.selection.set({ tag: "none" })
  library$.tagFilter.set({ tag: "all" })
}

export function openAssetTagEditor(asset: Asset) {
  library$.assetDialog.set({
    tag: "editing-tags",
    assetId: asset.id,
    selectedSlugs: asset.tags.map((tag) => tag.slug),
  })
}

export function toggleAssetTag(slug: string) {
  const dialog = library$.assetDialog.peek()
  if (dialog.tag !== "editing-tags") return
  const selectedSlugs = dialog.selectedSlugs.includes(slug)
    ? dialog.selectedSlugs.filter((selected) => selected !== slug)
    : [...dialog.selectedSlugs, slug]
  library$.assetDialog.set({ ...dialog, selectedSlugs })
}

export function openPublicShareManager(assetId: string) {
  library$.assetDialog.set({ tag: "sharing", assetId })
}

export function openDeleteConfirmation(assetId: string) {
  library$.assetDialog.set({ tag: "confirming-delete", assetId })
}

export function closeAssetDialog() {
  library$.assetDialog.set({ tag: "closed" })
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

export function openServiceTokenManager() {
  library$.serviceTokenManager.set({ tag: "open" })
}

export function closeServiceTokenManager() {
  library$.serviceTokenManager.set({ tag: "closed" })
}

export function clearDeletedAssetSelection(assetId: string) {
  const selection = library$.selection.peek()
  if (selection.tag === "selected" && selection.assetId === assetId) {
    library$.selection.set({ tag: "none" })
  }
  const dialog = library$.assetDialog.peek()
  if (dialog.tag !== "closed" && dialog.assetId === assetId) {
    library$.assetDialog.set({ tag: "closed" })
  }
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

export function openNewAsset(assetId: string) {
  library$.view.set({ tag: "active" })
  library$.tagFilter.set({ tag: "all" })
  library$.selection.set({ tag: "selected", assetId })
  library$.toast.set({ tag: "hidden" })
}

export function hideAssetToast() {
  library$.toast.set({ tag: "hidden" })
}
