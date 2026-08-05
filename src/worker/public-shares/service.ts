import type { Env } from "../env"
import { PublicShareUnavailableError, StorageFailureError } from "../errors"
import { findAssetFile } from "../data/repository"
import {
  confirmPublicShareActive,
  findActivePublicShareTarget,
  recordPublicShareAccess,
  type PublicShareTarget,
} from "../data/public-share-repository"
import { hashPublicShareToken, isPublicShareToken } from "./material"

async function requirePublicShareTarget({
  env,
  token,
  now,
}: {
  env: Env
  token: string
  now: Date
}) {
  if (!isPublicShareToken(token)) return new PublicShareUnavailableError()
  const tokenHash = await hashPublicShareToken(token)
  if (tokenHash instanceof Error) return tokenHash
  return findActivePublicShareTarget({ db: env.ASSET_BOX_DB, tokenHash, now })
}

async function readSharedAsset({
  env,
  target,
  source,
}: {
  env: Env
  target: PublicShareTarget
  source: { tag: "entry" } | { tag: "file"; path: string }
}) {
  const objectKey = await (async () => {
    if (source.tag === "entry") return target.object_key
    const file = await findAssetFile({
      db: env.ASSET_BOX_DB,
      assetId: target.asset_id,
      path: source.path,
    })
    if (file instanceof Error) return file
    if (file.tag === "missing") return new PublicShareUnavailableError()
    return file.value.object_key
  })()
  if (objectKey instanceof Error) return objectKey
  const object = await env.ASSET_BOX_BUCKET.get(objectKey).catch(
    (cause) => new StorageFailureError({ operation: "public share asset read", cause }),
  )
  if (object instanceof Error) return object
  if (object === null) return new StorageFailureError({ operation: "public share asset read" })
  return object
}

export async function openPublicShare({ env, token, now }: { env: Env; token: string; now: Date }) {
  const target = await requirePublicShareTarget({ env, token, now })
  if (target instanceof Error) return target

  const object = await env.ASSET_BOX_BUCKET.head(target.object_key).catch(
    (cause) => new StorageFailureError({ operation: "public share asset existence check", cause }),
  )
  if (object instanceof Error) return object
  if (object === null)
    return new StorageFailureError({ operation: "public share asset existence check" })

  const recorded = await recordPublicShareAccess({
    db: env.ASSET_BOX_DB,
    shareId: target.share_id,
    access: "view",
    now,
  })
  if (recorded instanceof Error) return recorded
  return { tag: "opened" as const, target }
}

export async function readPublicShareContent({
  env,
  token,
  now,
  source = { tag: "entry" },
}: {
  env: Env
  token: string
  now: Date
  source?: { tag: "entry" } | { tag: "file"; path: string }
}) {
  const target = await requirePublicShareTarget({ env, token, now })
  if (target instanceof Error) return target
  const object = await readSharedAsset({ env, target, source })
  if (object instanceof Error) return object
  const active = await confirmPublicShareActive({
    db: env.ASSET_BOX_DB,
    shareId: target.share_id,
    now,
  })
  if (active instanceof Error) return active
  return { tag: "content" as const, target, object }
}

export async function downloadPublicShare({
  env,
  token,
  now,
}: {
  env: Env
  token: string
  now: Date
}) {
  const target = await requirePublicShareTarget({ env, token, now })
  if (target instanceof Error) return target
  const object = await readSharedAsset({ env, target, source: { tag: "entry" } })
  if (object instanceof Error) return object

  const recorded = await recordPublicShareAccess({
    db: env.ASSET_BOX_DB,
    shareId: target.share_id,
    access: "download",
    now,
  })
  if (recorded instanceof Error) return recorded
  return { tag: "download" as const, target, object }
}
