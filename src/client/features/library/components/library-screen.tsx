import { useValue } from "@legendapp/state/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { lazy, Suspense } from "react"
import {
  Archive,
  Box,
  Circle,
  CodeXml,
  FilePlus2,
  Inbox,
  KeyRound,
  ListChecks,
  LogOut,
  Plus,
} from "lucide-react"
import { sessionQueryKey } from "@/client/app"
import { api, expectApiValue } from "@/client/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { libraryQueryKey, libraryQueryOptions } from "../api/library.queries"
import { useLiveUpdates } from "../hooks/use-live-updates"
import {
  clearTagFilter,
  filterByTag,
  openTagCreator,
  openServiceTokenManager,
  showActiveAssets,
  showArchivedAssets,
} from "../state/library.actions"
import { library$ } from "../state/library.store"
import { openNewAssetRequest, openRequestStatus } from "../state/work-request.actions"
import { filterAssets } from "../utils/filter-assets"
import { AssetList } from "./asset-list"
import { AssetPreview } from "./asset-preview"
import { NewAssetToast } from "./new-asset-toast"
import { TagSidebar } from "./tag-sidebar"
import { WorkRequestPanel } from "./work-request-panel"

const TagManagerDialog = lazy(() =>
  import("./tag-manager-dialog").then((module) => ({ default: module.TagManagerDialog })),
)
const ServiceTokenDialog = lazy(() =>
  import("./service-token-dialog").then((module) => ({ default: module.ServiceTokenDialog })),
)

export function LibraryScreen() {
  const queryClient = useQueryClient()
  const view = useValue(library$.view)
  const library = useQuery(libraryQueryOptions(view.tag))
  const search = useValue(library$.search)
  const tagFilter = useValue(library$.tagFilter)
  const selection = useValue(library$.selection)
  const liveConnection = useValue(library$.liveConnection)
  const tagManager = useValue(library$.tagManager)
  const serviceTokenManager = useValue(library$.serviceTokenManager)
  useLiveUpdates()

  const logout = useMutation({
    mutationFn: async () => expectApiValue(await api.logout()),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: libraryQueryKey })
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey })
    },
  })

  if (library.isPending) return <LibraryLoading />
  if (library.isError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">The library could not be opened</h1>
          <p className="mt-1 text-sm text-muted-foreground">{library.error.message}</p>
          <Button className="mt-4" variant="outline" onClick={() => library.refetch()}>
            Try again
          </Button>
        </div>
      </main>
    )
  }

  const filteredAssets = filterAssets({ assets: library.data.assets, search, tagFilter })
  const selectedAsset =
    selection.tag === "selected"
      ? library.data.assets.find((asset) => asset.id === selection.assetId)
      : undefined

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 flex-none items-center gap-3 border-b px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2 font-heading font-semibold">
          <span className="grid size-7 place-items-center bg-foreground text-background">
            <Box className="size-4" aria-hidden="true" />
          </span>
          <span>Asset Box</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span
            className="mr-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"
            title={
              liveConnection.tag === "connected"
                ? "Live updates connected"
                : "Live updates reconnecting"
            }
          >
            <Circle
              className={`size-2 fill-current ${liveConnection.tag === "connected" ? "text-emerald-600" : "text-amber-500"}`}
            />
            {liveConnection.tag === "connected" ? "Live" : "Reconnecting"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={openNewAssetRequest}
            aria-label="Request a new asset"
          >
            <FilePlus2 />
            <span className="hidden sm:inline">Request asset</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={openRequestStatus}>
            <ListChecks />
            <span className="hidden sm:inline">Requests</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={openTagCreator}
            aria-label="Create tag"
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openServiceTokenManager}
            aria-label="Manage service tokens"
          >
            <KeyRound />
          </Button>
          <Button variant="ghost" size="icon-sm" asChild>
            <a href="/api/docs" target="_blank" rel="noreferrer" aria-label="API documentation">
              <CodeXml />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            aria-label="Sign out"
          >
            <LogOut />
          </Button>
        </div>
      </header>

      <div className="flex flex-none gap-1 overflow-x-auto border-b p-2 md:hidden">
        <Button
          size="xs"
          variant={view.tag === "active" ? "default" : "outline"}
          onClick={showActiveAssets}
        >
          <Inbox /> Active
        </Button>
        <Button
          size="xs"
          variant={view.tag === "archived" ? "default" : "outline"}
          onClick={showArchivedAssets}
        >
          <Archive /> Archived
        </Button>
        <Button
          size="xs"
          variant={tagFilter.tag === "all" ? "default" : "outline"}
          onClick={clearTagFilter}
        >
          All {view.tag}
        </Button>
        {library.data.tags.map((tag) => (
          <Button
            key={tag.id}
            size="xs"
            variant={tagFilter.tag === "tag" && tagFilter.slug === tag.slug ? "default" : "outline"}
            onClick={() => filterByTag(tag.slug)}
          >
            {tag.name}
          </Button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <TagSidebar tags={library.data.tags} assetCount={library.data.assets.length} />
        <AssetList
          assets={filteredAssets}
          totalCount={library.data.assets.length}
          mobileHidden={selection.tag === "selected"}
        />
        <AssetPreview asset={selectedAsset} tags={library.data.tags} />
        <WorkRequestPanel />
      </div>

      {tagManager.tag === "closed" ? null : (
        <Suspense fallback={null}>
          <TagManagerDialog tags={library.data.tags} />
        </Suspense>
      )}
      {serviceTokenManager.tag === "closed" ? null : (
        <Suspense fallback={null}>
          <ServiceTokenDialog />
        </Suspense>
      )}
      <NewAssetToast />
    </main>
  )
}

function LibraryLoading() {
  return (
    <main className="flex h-dvh flex-col">
      <header className="flex h-14 items-center border-b px-4">
        <Skeleton className="h-7 w-28" />
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 border-r p-3 md:block">
          <Skeleton className="h-7 w-full" />
        </aside>
        <section className="w-full border-r p-3 md:w-[22rem]">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-4 h-20 w-full" />
          <Skeleton className="mt-2 h-20 w-full" />
        </section>
      </div>
    </main>
  )
}
