import { useValue } from "@legendapp/state/react"
import { Archive, Inbox, Plus, Tags } from "lucide-react"
import type { Tag } from "@/shared/domain"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  clearTagFilter,
  filterByTag,
  openTagCreator,
  openTagEditor,
  showActiveAssets,
  showArchivedAssets,
} from "../state/library.actions"
import { library$ } from "../state/library.store"

export function TagSidebar({ tags, assetCount }: { tags: Tag[]; assetCount: number }) {
  const filter = useValue(library$.tagFilter)
  const view = useValue(library$.view)

  return (
    <aside className="hidden w-60 flex-none flex-col border-r bg-sidebar md:flex">
      <div className="flex h-14 items-center justify-between px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Tags className="size-4" />
          Tags
        </div>
        <Button variant="ghost" size="icon-sm" onClick={openTagCreator} aria-label="Create tag">
          <Plus />
        </Button>
      </div>
      <Separator />
      <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Asset library">
        <div className="space-y-0.5">
          <button
            type="button"
            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${view.tag === "active" ? "bg-foreground text-background" : "hover:bg-black/5"}`}
            onClick={showActiveAssets}
          >
            <Inbox className="size-3.5" />
            <span className="flex-1">Active</span>
            {view.tag === "active" ? (
              <span className="text-xs opacity-60">{assetCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${view.tag === "archived" ? "bg-foreground text-background" : "hover:bg-black/5"}`}
            onClick={showArchivedAssets}
          >
            <Archive className="size-3.5" />
            <span className="flex-1">Archived</span>
            {view.tag === "archived" ? (
              <span className="text-xs opacity-60">{assetCount}</span>
            ) : null}
          </button>
        </div>
        <Separator className="my-2" />
        <button
          type="button"
          className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-sm ${filter.tag === "all" ? "bg-muted font-medium" : "hover:bg-black/5"}`}
          onClick={clearTagFilter}
        >
          <span>All {view.tag}</span>
          <span className="text-xs opacity-60">{assetCount}</span>
        </button>
        <div className="mt-2 space-y-0.5">
          {tags.map((tag) => (
            <div key={tag.id} className="group flex items-center">
              <button
                type="button"
                className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm ${filter.tag === "tag" && filter.slug === tag.slug ? "bg-foreground text-background" : "hover:bg-black/5"}`}
                title={tag.guidance}
                onClick={() => filterByTag(tag.slug)}
              >
                {tag.name}
              </button>
              <button
                type="button"
                className="px-2 py-1.5 text-xs text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                onClick={() => openTagEditor(tag.id)}
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      </nav>
      <div className="border-t p-3 text-[11px] leading-4 text-muted-foreground">
        Tag guidance tells upload agents when each label applies.
      </div>
    </aside>
  )
}
