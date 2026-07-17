import { ArrowLeft, ExternalLink } from "lucide-react"
import type { Asset } from "@/shared/domain"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { clearAssetSelection } from "../state/library.actions"

export function AssetPreview({ asset }: { asset: Asset | undefined }) {
  if (!asset) {
    return (
      <section className="hidden min-w-0 flex-1 place-items-center bg-muted/20 md:grid">
        <div className="max-w-xs text-center">
          <p className="text-sm font-medium">Select an asset</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Choose an item from the list to inspect the rendered page.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/20">
      <header className="flex min-h-14 items-center gap-2 border-b bg-background px-3 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={clearAssetSelection}
          aria-label="Back to assets"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{asset.title}</h1>
          <p className="truncate text-xs text-muted-foreground">{asset.blurb}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={`/assets/${asset.id}`} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            <span className="hidden sm:inline">Open</span>
          </a>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-2 md:p-3">
        <iframe
          className="min-h-0 flex-1 bg-white shadow-sm ring-1 ring-black/10"
          src={`/assets/${asset.id}`}
          title={asset.title}
          sandbox="allow-scripts"
        />
        <footer className="mt-2 flex min-h-6 flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span>{(asset.sizeBytes / 1024).toFixed(1)} KB</span>
          <span aria-hidden="true">·</span>
          <code className="truncate">{asset.id.slice(0, 12)}</code>
          {asset.tags.map((tag) => (
            <Badge key={tag.id} variant="outline" className="ml-1 text-[10px]">
              {tag.name}
            </Badge>
          ))}
        </footer>
      </div>
    </section>
  )
}
