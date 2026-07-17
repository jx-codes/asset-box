import type { Asset } from "@/shared/domain"
import type { TagFilter } from "../state/library.store"

export function filterAssets({
  assets,
  search,
  tagFilter,
}: {
  assets: Asset[]
  search: string
  tagFilter: TagFilter
}) {
  const normalizedSearch = search.trim().toLocaleLowerCase()

  return assets.filter((asset) => {
    const hasTag = tagFilter.tag === "all" || asset.tags.some((tag) => tag.slug === tagFilter.slug)
    if (!hasTag) return false
    if (normalizedSearch.length === 0) return true

    const searchableText = [
      asset.title,
      asset.blurb,
      ...asset.tags.flatMap((tag) => [tag.name, tag.guidance]),
    ]
      .join(" ")
      .toLocaleLowerCase()
    return searchableText.includes(normalizedSearch)
  })
}
