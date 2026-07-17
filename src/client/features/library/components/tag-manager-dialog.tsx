import { useValue } from "@legendapp/state/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Tag, TagInput } from "@/shared/domain"
import { TagInputSchema } from "@/shared/domain"
import { api, expectApiValue } from "@/client/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { libraryQueryKey } from "../api/library.queries"
import { closeTagManager } from "../state/library.actions"
import { library$ } from "../state/library.store"

type SaveTagCommand =
  | { tag: "create"; input: TagInput }
  | { tag: "update"; id: string; input: TagInput }

export function TagManagerDialog({ tags }: { tags: Tag[] }) {
  const state = useValue(library$.tagManager)
  const queryClient = useQueryClient()
  const editingTag =
    state.tag === "editing" ? tags.find((tag) => tag.id === state.tagId) : undefined

  const saveMutation = useMutation({
    mutationFn: async (command: SaveTagCommand) => {
      if (command.tag === "create") return expectApiValue(await api.createTag(command.input))
      return expectApiValue(await api.updateTag({ id: command.id, input: command.input }))
    },
    onSuccess: async () => {
      closeTagManager()
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => expectApiValue(await api.deleteTag(id)),
    onSuccess: async () => {
      closeTagManager()
      await queryClient.invalidateQueries({ queryKey: libraryQueryKey })
    },
  })

  const title = state.tag === "editing" ? "Edit tag" : "Create tag"
  const description =
    state.tag === "editing"
      ? "Update the label and the guidance agents see."
      : "Add a label with clear guidance for upload agents."

  return (
    <Dialog open={state.tag !== "closed"} onOpenChange={(open) => !open && closeTagManager()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          key={editingTag?.id ?? "new-tag"}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const values = Object.fromEntries(new FormData(event.currentTarget))
            const input = TagInputSchema.safeParse(values)
            if (!input.success) return
            if (editingTag) {
              saveMutation.mutate({ tag: "update", id: editingTag.id, input: input.data })
              return
            }
            saveMutation.mutate({ tag: "create", input: input.data })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="tag-name">Name</Label>
            <Input
              id="tag-name"
              name="name"
              required
              maxLength={40}
              defaultValue={editingTag?.name}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-slug">Slug</Label>
            <Input
              id="tag-slug"
              name="slug"
              required
              maxLength={40}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="landing-page"
              defaultValue={editingTag?.slug}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-guidance">Agent guidance</Label>
            <Textarea
              id="tag-guidance"
              name="guidance"
              required
              maxLength={280}
              rows={4}
              placeholder="Use for polished product landing pages ready to share."
              defaultValue={editingTag?.guidance}
            />
          </div>
          {saveMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {saveMutation.error.message}
            </p>
          ) : null}
          {deleteMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteMutation.error.message}
            </p>
          ) : null}
          <DialogFooter className="flex-row justify-between sm:justify-between">
            {editingTag ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => deleteMutation.mutate(editingTag.id)}
                disabled={deleteMutation.isPending || saveMutation.isPending}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeTagManager}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending || deleteMutation.isPending}>
                {saveMutation.isPending ? "Saving…" : "Save tag"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
