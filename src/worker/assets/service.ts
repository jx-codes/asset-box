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
type UploadInput = {
  file: File
  title: string
  blurb: string
  tagSlugs: string[]
}
function normalizeTagSlugs(tagSlugs: string[]) {
  const parsed = errore.try({
    try: () => Array.from(new Set(tagSlugs.map((slug) => TagSlugSchema.parse(slug)))),
    catch: (cause) => new InvalidInputError({ reason: "One or more tag slugs are invalid", cause }),
  })
  return parsed
}

function newAsset({
  id,
  input,
  tags,
  now,
}: {
  id: string
  input: UploadInput
  tags: Tag[]
  now: Date
}) {
  return AssetSchema.parse({
    id,
    title: input.title.trim(),
    blurb: input.blurb.trim(),
    sizeBytes: input.file.size,
    createdAt: now.toISOString(),
    lifecycle: { tag: "active" },
    tags,
  })
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

  const buffer = await input.file
    .arrayBuffer()
    .catch((cause) => new StorageFailureError({ operation: "upload reading", cause }))
  if (buffer instanceof Error) return buffer
  const bytes = new Uint8Array(buffer)

  const validHtml = validateHtmlBytes(bytes)
  if (validHtml instanceof Error) return validHtml

  const id = await hashAssetBytes(bytes)
  if (id instanceof Error) return id

  const existing = await findAsset({ db: env.ASSET_BOX_DB, id })
  if (existing instanceof Error) return existing
  if (existing.tag === "found") return { status: "duplicate" as const, asset: existing.value }

  const storageRecord = await findAssetStorageRecord({ db: env.ASSET_BOX_DB, id })
  if (storageRecord instanceof Error) return storageRecord
  if (storageRecord.tag === "found") return new AssetDeletePendingError({ id })

  const tags = await requireTagsBySlugs({ db: env.ASSET_BOX_DB, slugs: tagSlugs })
  if (tags instanceof Error) return tags

  const asset = errore.try({
    try: () => newAsset({ id, input, tags, now }),
    catch: (cause) => new InvalidInputError({ reason: "Asset metadata is invalid", cause }),
  })
  if (asset instanceof Error) return asset

  const stored = await env.ASSET_BOX_BUCKET.put(`assets/${asset.id}.html`, bytes, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: { sha256: asset.id },
  }).catch((cause) => new StorageFailureError({ operation: "asset write", cause }))
  if (stored instanceof Error) return stored

  const inserted = await insertAsset({ db: env.ASSET_BOX_DB, asset })
  if (inserted instanceof Error) return inserted

  return { status: "created" as const, asset: inserted }
}
