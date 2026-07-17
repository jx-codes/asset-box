import { useValue } from "@legendapp/state/react"
import { useEffect } from "react"
import { Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { hideAssetToast, selectAsset } from "../state/library.actions"
import { library$ } from "../state/library.store"

export function NewAssetToast() {
  const toast = useValue(library$.toast)

  useEffect(() => {
    if (toast.tag === "hidden") return
    const timer = window.setTimeout(hideAssetToast, 6_000)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (toast.tag === "hidden") return null

  return (
    <aside className="fixed bottom-4 right-4 z-40 flex w-[calc(100%-2rem)] max-w-sm items-start gap-3 border bg-foreground p-3 text-background shadow-xl">
      <Box className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-background/60">New asset</p>
        <p className="truncate text-sm font-semibold">{toast.asset.title}</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          selectAsset(toast.asset.id)
          hideAssetToast()
        }}
      >
        View
      </Button>
    </aside>
  )
}
