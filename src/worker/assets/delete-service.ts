import type { Env } from "../env"
import { StorageFailureError } from "../errors"
import { beginAssetDeletion } from "../data/repository"

export async function deleteAsset({ env, id, now }: { env: Env; id: string; now: Date }) {
  const deletion = await beginAssetDeletion({ db: env.ASSET_BOX_DB, id, now })
  if (deletion instanceof Error) return deletion

  const removed = await env.ASSET_BOX_BUCKET.delete(deletion.objectKey).catch(
    (cause) => new StorageFailureError({ operation: "asset deletion", cause }),
  )
  if (removed instanceof Error) return removed

  return { tag: "deleted" as const, id }
}
