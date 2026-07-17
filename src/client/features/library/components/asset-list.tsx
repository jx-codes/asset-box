import { useValue } from "@legendapp/state/react"
import { Search } from "lucide-react"
import type { Asset } from "@/shared/domain"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { changeSearch, selectAsset } from "../state/library.actions"
import { library$ } from "../state/library.store"

export function AssetList({
  assets,
  totalCount,
  mobileHidden,
}: {
  assets: Asset[]
  totalCount: number
  mobileHidden: boolean
}) {
  const search = useValue(library$.search)
  const selection = useValue(library$.selection)

  return (
    <section
      className={`min-h-0 flex-1 flex-col border-border md:flex md:w-[22rem] md:flex-none md:border-r ${mobileHidden ? "hidden" : "flex"}`}
    >
      <header className="border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search assets"
            className="pl-8"
            placeholder="Search assets"
            value={search}
            onChange={(event) => changeSearch(event.currentTarget.value)}
          />
        </div>
        <p className="mt-2 px-0.5 text-xs text-muted-foreground">
          {assets.length === totalCount
            ? `${totalCount} assets`
            : `${assets.length} of ${totalCount} assets`}
        </p>
      </header>

      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Assets">
        {assets.length === 0 ? (
          <li className="p-8 text-center">
            <p className="text-sm font-medium">No assets found</p>
            <p className="mt-1 text-xs text-muted-foreground">Try another search or tag.</p>
          </li>
        ) : (
          assets.map((asset) => {
            const selected = selection.tag === "selected" && selection.assetId === asset.id
            return (
              <li key={asset.id}>
                <button
                  type="button"
                  className={`block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/70 ${selected ? "bg-muted" : "bg-background"}`}
                  onClick={() => selectAsset(asset.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="truncate text-sm font-semibold">{asset.title}</h2>
                    <time
                      className="shrink-0 text-[11px] text-muted-foreground"
                      dateTime={asset.createdAt}
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                      }).format(new Date(asset.createdAt))}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {asset.blurb}
                  </p>
                  {asset.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {asset.tags.map((tag) => (
                        <Badge key={tag.id} variant="secondary" className="text-[10px]">
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}
