import * as errore from "errore"
import { AssetSchema } from "@/shared/domain"
import { WorkPullContextSchema, type WorkResultPushInput } from "@/shared/work-requests"
import { hashAssetBytes, validateHtmlBytes } from "../assets/html-content"
import { getClaimContext, requireOwnedClaim } from "../data/work-request-repository"
import { commitWorkResult, findIdempotentWorkResult } from "../data/work-result-repository"
import type { Env } from "../env"
import { InvalidInputError, StorageFailureError, WorkResultConflictError } from "../errors"

export async function pullClaimContext({
  env,
  claimId,
  principalId,
  now,
}: {
  env: Env
  claimId: string
  principalId: string
  now: Date
}) {
  const context = await getClaimContext({ db: env.ASSET_BOX_DB, claimId, principalId, now })
  if (context instanceof Error) return context
  if (context.sourceAssetId === null) {
    return WorkPullContextSchema.parse({ ...context, source: { tag: "none" } })
  }

  const object = await env.ASSET_BOX_BUCKET.get(`assets/${context.sourceAssetId}.html`).catch(
    (cause) => new StorageFailureError({ operation: "work request source read", cause }),
  )
  if (object instanceof Error) return object
  if (object === null) return new StorageFailureError({ operation: "work request source read" })
  const html = await object
    .text()
    .catch((cause) => new StorageFailureError({ operation: "work request source decoding", cause }))
  if (html instanceof Error) return html

  return WorkPullContextSchema.parse({
    ...context,
    source: { tag: "html", assetId: context.sourceAssetId, html },
  })
}

export async function pushWorkResult({
  env,
  claimId,
  principalId,
  input,
  now,
}: {
  env: Env
  claimId: string
  principalId: string
  input: WorkResultPushInput
  now: Date
}) {
  const replay = await findIdempotentWorkResult({
    db: env.ASSET_BOX_DB,
    claimId,
    principalId,
    idempotencyKey: input.idempotencyKey,
  })
  if (replay instanceof Error) return replay
  if (replay.tag === "found") return replay.value

  const claim = await requireOwnedClaim({ db: env.ASSET_BOX_DB, claimId, principalId, now })
  if (claim instanceof Error) return claim
  if (claim.resultIdempotencyKey !== input.idempotencyKey) {
    return new WorkResultConflictError({
      reason: "The result idempotency key does not match the claimed work snapshot",
    })
  }

  const bytes = new TextEncoder().encode(input.html)
  const validHtml = validateHtmlBytes(bytes)
  if (validHtml instanceof Error) return validHtml
  const id = await hashAssetBytes(bytes)
  if (id instanceof Error) return id

  const context = await getClaimContext({ db: env.ASSET_BOX_DB, claimId, principalId, now })
  if (context instanceof Error) return context
  const parentAssetId = context.sourceAssetId
  if (parentAssetId === id) {
    return new WorkResultConflictError({
      reason: "Result HTML is unchanged from the parent asset",
    })
  }

  const asset = errore.try({
    try: () =>
      AssetSchema.parse({
        id,
        title: input.title,
        blurb: input.blurb,
        sizeBytes: bytes.byteLength,
        createdAt: now.toISOString(),
        lifecycle: { tag: "active" },
        tags: [],
      }),
    catch: (cause) => new InvalidInputError({ reason: "Result metadata is invalid", cause }),
  })
  if (asset instanceof Error) return asset

  const objectKey = `assets/${asset.id}.html`
  const existingObject = await env.ASSET_BOX_BUCKET.head(objectKey).catch(
    (cause) => new StorageFailureError({ operation: "result existence check", cause }),
  )
  if (existingObject instanceof Error) return existingObject
  if (existingObject !== null && existingObject.customMetadata?.sha256 !== asset.id) {
    return new WorkResultConflictError({
      reason: "Immutable asset storage already contains different object metadata for this id",
    })
  }
  if (existingObject === null) {
    const stored = await env.ASSET_BOX_BUCKET.put(objectKey, bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { sha256: asset.id },
    }).catch((cause) => new StorageFailureError({ operation: "result asset write", cause }))
    if (stored instanceof Error) return stored
  }

  return commitWorkResult({
    db: env.ASSET_BOX_DB,
    claim,
    principalId,
    idempotencyKey: input.idempotencyKey,
    asset,
    parentAssetId,
    tagSlugs: input.tagSlugs,
    now,
  })
}
