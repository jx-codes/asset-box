import { useValue } from "@legendapp/state/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, Tags, Trash2 } from "lucide-react"
import type { Asset, Tag } from "@/shared/domain"
import { api, expectApiValue } from "@/client/lib/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { libraryQueryKey } from "../api/library.queries"
import {
  closeAssetDialog,
  clearAssetSelection,
  clearDeletedAssetSelection,
  openAssetTagEditor,
  openDeleteConfirmation,
  toggleAssetTag,
} from "../state/library.actions"
import { library$ } from "../state/library.store"

export function AssetActions({ asset, tags }: { asset: Asset; tags: Tag[] }) {
  const dialog = useValue(library$.assetDialog)
  const queryClient = useQueryClient()

  const lifecycleMutation = useMutation({
    mutationFn: async () =>
      expectApiValue(
        await api.updateAssetLifecycle({
          id: asset.id,
          input: asset.lifecycle.tag === "active" ? { tag: "archived" } : { tag: "active" },
        }),
      ),
    onSuccess: async () => {
      clearAssetSelection()
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
  })

  const tagsMutation = useMutation({
    mutationFn: async (tagSlugs: string[]) =>
      expectApiValue(await api.updateAssetTags({ id: asset.id, input: { tagSlugs } })),
    onSuccess: async () => {
      closeAssetDialog()
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => expectApiValue(await api.deleteAsset(asset.id)),
    onSuccess: async () => {
      clearDeletedAssetSelection(asset.id)
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
  })

  const editingTags = dialog.tag === "editing-tags" && dialog.assetId === asset.id
  const confirmingDelete = dialog.tag === "confirming-delete" && dialog.assetId === asset.id

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => lifecycleMutation.mutate()}
          disabled={lifecycleMutation.isPending}
          aria-label={asset.lifecycle.tag === "active" ? "Archive asset" : "Restore asset"}
        >
          {asset.lifecycle.tag === "active" ? <Archive /> : <ArchiveRestore />}
          <span className="hidden lg:inline">
            {asset.lifecycle.tag === "active" ? "Archive" : "Restore"}
          </span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            tagsMutation.reset()
            openAssetTagEditor(asset)
          }}
          aria-label="Edit asset tags"
        >
          <Tags />
          <span className="hidden lg:inline">Tags</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            deleteMutation.reset()
            openDeleteConfirmation(asset.id)
          }}
          aria-label="Delete asset"
        >
          <Trash2 />
        </Button>
      </div>

      <Dialog open={editingTags} onOpenChange={(open) => !open && closeAssetDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit asset tags</DialogTitle>
            <DialogDescription>
              Choose the guidance labels that apply to “{asset.title}”.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto py-1">
            {tags.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted-foreground">
                Create a tag before assigning one to this asset.
              </p>
            ) : (
              tags.map((tag) => (
                <Label
                  key={tag.id}
                  className="flex cursor-pointer items-start gap-3 border p-3 font-normal"
                >
                  <Checkbox
                    checked={editingTags && dialog.selectedSlugs.includes(tag.slug)}
                    onCheckedChange={() => toggleAssetTag(tag.slug)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{tag.name}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {tag.guidance}
                    </span>
                  </span>
                </Label>
              ))
            )}
          </div>
          {tagsMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {tagsMutation.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeAssetDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (dialog.tag === "editing-tags") tagsMutation.mutate(dialog.selectedSlugs)
              }}
              disabled={tagsMutation.isPending}
            >
              {tagsMutation.isPending ? "Saving…" : "Save tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDelete} onOpenChange={(open) => !open && closeAssetDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this asset?</DialogTitle>
            <DialogDescription>
              “{asset.title}” and its stored HTML will be permanently deleted. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {deleteMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={closeAssetDialog}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lifecycleMutation.isError ? (
        <span
          className="fixed bottom-4 left-4 z-50 max-w-sm border border-destructive/30 bg-background p-3 text-sm text-destructive shadow"
          role="alert"
        >
          {lifecycleMutation.error.message}
        </span>
      ) : null}
    </>
  )
}
