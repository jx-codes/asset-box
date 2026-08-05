import * as errore from "errore"
import { AssetSchema, type Tag, TagSlugSchema } from "@/shared/domain"
import {
  findAsset,
  findAssetStorageRecord,
  insertAsset,
  requireTagsBySlugs,
} from "../data/repository"
import type { Env } from "../env"
import { AssetDeletePendingError, InvalidInputError, StorageFailureError } from "../errors"
import { hashAssetBytes, validateHtmlBytes } from "./html-content"
import {
  ASSET_ENTRY_PATH,
  type AssetResourceFile,
  hashAssetResource,
  storedAssetFiles,
  validateAssetResource,
} from "./resource"

type UploadContent =
  | { tag: "legacy-html"; file: File }
  | { tag: "html-files"; files: Array<{ path: string; file: File }> }

type UploadInput = {
  content: UploadContent
  title: string
  blurb: string
  tagSlugs: string[]
}

function normalizeTagSlugs(tagSlugs: string[]) {
  return errore.try({
    try: () => Array.from(new Set(tagSlugs.map((slug) => TagSlugSchema.parse(slug)))),
    catch: (cause) => new InvalidInputError({ reason: "One or more tag slugs are invalid", cause }),
  })
}

async function readFile({ file, operation }: { file: File; operation: string }) {
  const buffer = await file
    .arrayBuffer()
    .catch((cause) => new StorageFailureError({ operation, cause }))
  if (buffer instanceof Error) return buffer
  return new Uint8Array(buffer)
}

async function prepareUploadContent(content: UploadContent) {
  if (content.tag === "legacy-html") {
    const bytes = await readFile({ file: content.file, operation: "upload reading" })
    if (bytes instanceof Error) return bytes
    const validHtml = validateHtmlBytes(bytes)
    if (validHtml instanceof Error) return validHtml
    const id = await hashAssetBytes(bytes)
    if (id instanceof Error) return id
    const contentSha256 = id
    return {
      id,
      files: [{ path: ASSET_ENTRY_PATH, bytes }],
      storageFiles: [
        {
          path: ASSET_ENTRY_PATH,
          objectKey: `assets/${id}.html`,
          sizeBytes: bytes.byteLength,
          contentSha256,
        },
      ],
      totalBytes: bytes.byteLength,
    }
  }

  const files: AssetResourceFile[] = []
  for (const inputFile of content.files) {
    const bytes = await readFile({
      file: inputFile.file,
      operation: `upload reading ${inputFile.path}`,
    })
    if (bytes instanceof Error) return bytes
    files.push({ path: inputFile.path, bytes })
  }
  const valid = validateAssetResource(files)
  if (valid instanceof Error) return valid
  const id = await hashAssetResource(files)
  if (id instanceof Error) return id
  const storageFiles = await storedAssetFiles({ assetId: id, files })
  if (storageFiles instanceof Error) return storageFiles
  return { id, files, storageFiles, totalBytes: valid.totalBytes }
}

function newAsset({
  id,
  input,
  tags,
  sizeBytes,
  now,
}: {
  id: string
  input: UploadInput
  tags: Tag[]
  sizeBytes: number
  now: Date
}) {
  return AssetSchema.parse({
    id,
    title: input.title.trim(),
    blurb: input.blurb.trim(),
    sizeBytes,
    createdAt: now.toISOString(),
    lifecycle: { tag: "active" },
    tags,
  })
}

async function storeAssetFiles({
  env,
  files,
  storageFiles,
}: {
  env: Env
  files: AssetResourceFile[]
  storageFiles: Array<{ path: string; objectKey: string; contentSha256: string }>
}) {
  const storedKeys: string[] = []
  for (const storageFile of storageFiles) {
    const file = files.find((candidate) => candidate.path === storageFile.path)
    if (!file) return new StorageFailureError({ operation: "asset file matching" })
    const stored = await env.ASSET_BOX_BUCKET.put(storageFile.objectKey, file.bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
      customMetadata: { sha256: storageFile.contentSha256 },
    }).catch(
      (cause) => new StorageFailureError({ operation: `asset write ${storageFile.path}`, cause }),
    )
    if (stored instanceof Error) {
      if (storedKeys.length === 0) return stored
      const cleanup = await env.ASSET_BOX_BUCKET.delete(storedKeys).catch(
        (cause) =>
          new StorageFailureError({
            operation: "failed upload cleanup",
            cause: new AggregateError([stored, cause], "Asset write and cleanup both failed"),
          }),
      )
      if (cleanup instanceof Error) return cleanup
      return stored
    }
    storedKeys.push(storageFile.objectKey)
  }
  return { tag: "stored" as const }
}

export async function uploadAsset({
  env,
  input,
  now,
}: {
  env: Env
  input: UploadInput
  now: Date
}) {
  const tagSlugs = normalizeTagSlugs(input.tagSlugs)
  if (tagSlugs instanceof Error) return tagSlugs

  const content = await prepareUploadContent(input.content)
  if (content instanceof Error) return content

  const existing = await findAsset({ db: env.ASSET_BOX_DB, id: content.id })
  if (existing instanceof Error) return existing
  if (existing.tag === "found") return { status: "duplicate" as const, asset: existing.value }

  const storageRecord = await findAssetStorageRecord({ db: env.ASSET_BOX_DB, id: content.id })
  if (storageRecord instanceof Error) return storageRecord
  if (storageRecord.tag === "found") return new AssetDeletePendingError({ id: content.id })

  const tags = await requireTagsBySlugs({ db: env.ASSET_BOX_DB, slugs: tagSlugs })
  if (tags instanceof Error) return tags

  const asset = errore.try({
    try: () => newAsset({ id: content.id, input, tags, sizeBytes: content.totalBytes, now }),
    catch: (cause) => new InvalidInputError({ reason: "Asset metadata is invalid", cause }),
  })
  if (asset instanceof Error) return asset

  const stored = await storeAssetFiles({
    env,
    files: content.files,
    storageFiles: content.storageFiles,
  })
  if (stored instanceof Error) return stored

  const entryFile = content.storageFiles.find((file) => file.path === ASSET_ENTRY_PATH)
  if (!entryFile) return new StorageFailureError({ operation: "asset entrypoint selection" })
  const inserted = await insertAsset({
    db: env.ASSET_BOX_DB,
    asset,
    entryObjectKey: entryFile.objectKey,
    files: content.storageFiles,
  })
  if (inserted instanceof Error) return inserted

  return { status: "created" as const, asset: inserted }
}
