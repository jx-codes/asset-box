import * as errore from "errore"
import { AssetSchema } from "@/shared/domain"
import { WorkPullContextSchema, type WorkResultPushInput } from "@/shared/work-requests"
import { hashAssetBytes, validateHtmlBytes } from "../assets/html-content"
import {
  ASSET_ENTRY_PATH,
  type AssetResourceFile,
  hashAssetResource,
  storedAssetFiles,
  validateAssetResource,
} from "../assets/resource"
import { listAssetFiles } from "../data/repository"
import { getClaimContext, requireOwnedClaim } from "../data/work-request-repository"
import { commitWorkResult, findIdempotentWorkResult } from "../data/work-result-repository"
import type { Env } from "../env"
import { InvalidInputError, StorageFailureError, WorkResultConflictError } from "../errors"

async function readSourceFiles({ env, assetId }: { env: Env; assetId: string }) {
  const records = await listAssetFiles({ db: env.ASSET_BOX_DB, assetId })
  if (records instanceof Error) return records
  if (records.length === 0)
    return new StorageFailureError({ operation: "work request source listing" })
  const files: Array<{ path: string; html: string }> = []
  for (const record of records) {
    const object = await env.ASSET_BOX_BUCKET.get(record.object_key).catch(
      (cause) =>
        new StorageFailureError({ operation: `work request source read ${record.path}`, cause }),
    )
    if (object instanceof Error) return object
    if (object === null)
      return new StorageFailureError({ operation: `work request source read ${record.path}` })
    const html = await object.text().catch(
      (cause) =>
        new StorageFailureError({
          operation: `work request source decoding ${record.path}`,
          cause,
        }),
    )
    if (html instanceof Error) return html
    files.push({ path: record.path, html })
  }
  return files
}

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

  const files = await readSourceFiles({ env, assetId: context.sourceAssetId })
  if (files instanceof Error) return files
  const entry = files.find((file) => file.path === ASSET_ENTRY_PATH)
  if (!entry)
    return new StorageFailureError({ operation: "work request source entrypoint selection" })
  return WorkPullContextSchema.parse({
    ...context,
    source: {
      tag: "html",
      assetId: context.sourceAssetId,
      html: entry.html,
      ...(files.length === 1 ? {} : { files }),
    },
  })
}

async function prepareResultContent(input: WorkResultPushInput) {
  if (input.files === undefined) {
    const bytes = new TextEncoder().encode(input.html)
    const validHtml = validateHtmlBytes(bytes)
    if (validHtml instanceof Error) return validHtml
    const id = await hashAssetBytes(bytes)
    if (id instanceof Error) return id
    return {
      id,
      files: [{ path: ASSET_ENTRY_PATH, bytes }],
      storageFiles: [
        {
          path: ASSET_ENTRY_PATH,
          objectKey: `assets/${id}.html`,
          sizeBytes: bytes.byteLength,
          contentSha256: id,
        },
      ],
      totalBytes: bytes.byteLength,
    }
  }

  const entry = input.files.find((file) => file.path === ASSET_ENTRY_PATH)
  if (entry?.html !== input.html) {
    return new InvalidInputError({ reason: "Result html must equal files[index.html].html" })
  }
  const files = input.files.map((file) => ({
    path: file.path,
    bytes: new TextEncoder().encode(file.html),
  }))
  const valid = validateAssetResource(files)
  if (valid instanceof Error) return valid
  const id = await hashAssetResource(files)
  if (id instanceof Error) return id
  const storageFiles = await storedAssetFiles({ assetId: id, files })
  if (storageFiles instanceof Error) return storageFiles
  return { id, files, storageFiles, totalBytes: valid.totalBytes }
}

async function storeResultFiles({
  env,
  files,
  storageFiles,
}: {
  env: Env
  files: AssetResourceFile[]
  storageFiles: Array<{ path: string; objectKey: string; contentSha256: string }>
}) {
  const createdKeys: string[] = []
  for (const storageFile of storageFiles) {
    const existing = await env.ASSET_BOX_BUCKET.head(storageFile.objectKey).catch(
      (cause) =>
        new StorageFailureError({ operation: `result existence check ${storageFile.path}`, cause }),
    )
    if (existing instanceof Error) return existing
    if (existing !== null && existing.customMetadata?.sha256 !== storageFile.contentSha256) {
      return new WorkResultConflictError({
        reason: `Immutable asset storage contains different metadata for ${storageFile.path}`,
      })
    }
    if (existing !== null) continue
    const file = files.find((candidate) => candidate.path === storageFile.path)
    if (!file) return new StorageFailureError({ operation: "result file matching" })
    const stored = await env.ASSET_BOX_BUCKET.put(storageFile.objectKey, file.bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { sha256: storageFile.contentSha256 },
    }).catch(
      (cause) =>
        new StorageFailureError({ operation: `result asset write ${storageFile.path}`, cause }),
    )
    if (stored instanceof Error) {
      if (createdKeys.length === 0) return stored
      const cleanup = await env.ASSET_BOX_BUCKET.delete(createdKeys).catch(
        (cause) =>
          new StorageFailureError({
            operation: "failed result cleanup",
            cause: new AggregateError([stored, cause], "Result write and cleanup both failed"),
          }),
      )
      if (cleanup instanceof Error) return cleanup
      return stored
    }
    createdKeys.push(storageFile.objectKey)
  }
  return { tag: "stored" as const }
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

  const content = await prepareResultContent(input)
  if (content instanceof Error) return content
  const context = await getClaimContext({ db: env.ASSET_BOX_DB, claimId, principalId, now })
  if (context instanceof Error) return context
  const parentAssetId = context.sourceAssetId
  if (parentAssetId === content.id) {
    return new WorkResultConflictError({ reason: "Result HTML is unchanged from the parent asset" })
  }

  const asset = errore.try({
    try: () =>
      AssetSchema.parse({
        id: content.id,
        title: input.title,
        blurb: input.blurb,
        sizeBytes: content.totalBytes,
        createdAt: now.toISOString(),
        lifecycle: { tag: "active" },
        tags: [],
      }),
    catch: (cause) => new InvalidInputError({ reason: "Result metadata is invalid", cause }),
  })
  if (asset instanceof Error) return asset

  const stored = await storeResultFiles({
    env,
    files: content.files,
    storageFiles: content.storageFiles,
  })
  if (stored instanceof Error) return stored
  const entryFile = content.storageFiles.find((file) => file.path === ASSET_ENTRY_PATH)
  if (!entryFile) return new StorageFailureError({ operation: "result entrypoint selection" })

  return commitWorkResult({
    db: env.ASSET_BOX_DB,
    claim,
    principalId,
    idempotencyKey: input.idempotencyKey,
    asset,
    entryObjectKey: entryFile.objectKey,
    files: content.storageFiles,
    parentAssetId,
    tagSlugs: input.tagSlugs,
    now,
  })
}
