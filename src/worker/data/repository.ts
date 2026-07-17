import * as errore from "errore"
import { z } from "zod"
import {
  type AssetLifecycleInput,
  AssetSchema,
  type Asset,
  type Library,
  type LibraryView,
  TagSchema,
  type Tag,
  type TagInput,
} from "@/shared/domain"
import {
  AssetNotFoundError,
  DatabaseFailureError,
  TagConflictError,
  TagNotFoundError,
  UnknownTagError,
} from "../errors"

const AssetRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  blurb: z.string(),
  object_key: z.string(),
  size_bytes: z.number(),
  created_at: z.string(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
})

export type AssetStorageRecord = z.infer<typeof AssetRowSchema>

const TagRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  guidance: z.string(),
  created_at: z.string(),
})

const AssetTagRowSchema = z.object({ asset_id: z.string(), tag_id: z.string() })

type Lookup<T> = { tag: "found"; value: T } | { tag: "missing" }

async function readRows<T>({
  statement,
  schema,
  operation,
}: {
  statement: D1PreparedStatement
  schema: z.ZodType<T>
  operation: string
}) {
  const result = await statement
    .all()
    .catch((cause) => new DatabaseFailureError({ operation, cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation })

  return errore.try({
    try: () => z.array(schema).parse(result.results),
    catch: (cause) => new DatabaseFailureError({ operation: `${operation} result parsing`, cause }),
  })
}

async function readFirst<T>({
  statement,
  schema,
  operation,
}: {
  statement: D1PreparedStatement
  schema: z.ZodType<T>
  operation: string
}): Promise<DatabaseFailureError | Lookup<T>> {
  const result = await statement
    .first()
    .catch((cause) => new DatabaseFailureError({ operation, cause }))
  if (result instanceof Error) return result
  if (result === null) return { tag: "missing" }

  const parsed = errore.try({
    try: () => schema.parse(result),
    catch: (cause) => new DatabaseFailureError({ operation: `${operation} result parsing`, cause }),
  })
  if (parsed instanceof Error) return parsed
  return { tag: "found", value: parsed }
}

function toTag(row: z.infer<typeof TagRowSchema>): Tag {
  return TagSchema.parse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    guidance: row.guidance,
    createdAt: row.created_at,
  })
}

function toAsset({ row, tags }: { row: AssetStorageRecord; tags: Tag[] }): Asset {
  return AssetSchema.parse({
    id: row.id,
    title: row.title,
    blurb: row.blurb,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    lifecycle:
      row.archived_at === null
        ? { tag: "active" }
        : { tag: "archived", archivedAt: row.archived_at },
    tags,
  })
}

export async function getLibrary({
  db,
  view,
}: {
  db: D1Database
  view: LibraryView
}): Promise<DatabaseFailureError | Library> {
  const lifecycleClause = view === "active" ? "archived_at IS NULL" : "archived_at IS NOT NULL"
  const [assetRows, tagRows, linkRows] = await Promise.all([
    readRows({
      statement: db.prepare(
        `SELECT id, title, blurb, object_key, size_bytes, created_at, archived_at, deleted_at
         FROM assets
         WHERE deleted_at IS NULL AND ${lifecycleClause}
         ORDER BY created_at DESC`,
      ),
      schema: AssetRowSchema,
      operation: "asset listing",
    }),
    readRows({
      statement: db.prepare(
        "SELECT id, name, slug, guidance, created_at FROM tags ORDER BY name COLLATE NOCASE",
      ),
      schema: TagRowSchema,
      operation: "tag listing",
    }),
    readRows({
      statement: db.prepare("SELECT asset_id, tag_id FROM asset_tags"),
      schema: AssetTagRowSchema,
      operation: "asset tag listing",
    }),
  ])
  if (assetRows instanceof Error) return assetRows
  if (tagRows instanceof Error) return tagRows
  if (linkRows instanceof Error) return linkRows

  const tags = tagRows.map(toTag)
  const assets = assetRows.map((row) =>
    toAsset({
      row,
      tags: tags.filter((tag) =>
        linkRows.some((link) => link.asset_id === row.id && link.tag_id === tag.id),
      ),
    }),
  )

  return { assets, tags }
}

export async function findAsset({ db, id }: { db: D1Database; id: string }) {
  const assetRow = await readFirst({
    statement: db
      .prepare(
        `SELECT id, title, blurb, object_key, size_bytes, created_at, archived_at, deleted_at
         FROM assets WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(id),
    schema: AssetRowSchema,
    operation: "asset lookup",
  })
  if (assetRow instanceof Error) return assetRow
  if (assetRow.tag === "missing") return assetRow

  const tagRows = await readRows({
    statement: db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.guidance, t.created_at
         FROM tags t
         INNER JOIN asset_tags at ON at.tag_id = t.id
         WHERE at.asset_id = ?
         ORDER BY t.name COLLATE NOCASE`,
      )
      .bind(id),
    schema: TagRowSchema,
    operation: "asset tag lookup",
  })
  if (tagRows instanceof Error) return tagRows

  return {
    tag: "found" as const,
    value: toAsset({ row: assetRow.value, tags: tagRows.map(toTag) }),
  }
}

export async function requireAsset({ db, id }: { db: D1Database; id: string }) {
  const result = await findAsset({ db, id })
  if (result instanceof Error) return result
  if (result.tag === "missing") return new AssetNotFoundError({ id })
  return result.value
}

export async function findAssetStorageRecord({ db, id }: { db: D1Database; id: string }) {
  return readFirst({
    statement: db
      .prepare(
        `SELECT id, title, blurb, object_key, size_bytes, created_at, archived_at, deleted_at
         FROM assets WHERE id = ?`,
      )
      .bind(id),
    schema: AssetRowSchema,
    operation: "asset storage record lookup",
  })
}

export async function requireTagsBySlugs({ db, slugs }: { db: D1Database; slugs: string[] }) {
  if (slugs.length === 0) return []

  const placeholders = slugs.map(() => "?").join(", ")
  const rows = await readRows({
    statement: db
      .prepare(
        `SELECT id, name, slug, guidance, created_at FROM tags WHERE slug IN (${placeholders})`,
      )
      .bind(...slugs),
    schema: TagRowSchema,
    operation: "upload tag lookup",
  })
  if (rows instanceof Error) return rows

  const tags = rows.map(toTag)
  const missingSlug = slugs.find((slug) => !tags.some((tag) => tag.slug === slug))
  if (missingSlug) return new UnknownTagError({ slug: missingSlug })
  return tags
}

export async function insertAsset({ db, asset }: { db: D1Database; asset: Asset }) {
  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO assets (id, title, blurb, object_key, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        asset.id,
        asset.title,
        asset.blurb,
        `assets/${asset.id}.html`,
        asset.sizeBytes,
        asset.createdAt,
      ),
    ...asset.tags.map((tag) =>
      db
        .prepare("INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)")
        .bind(asset.id, tag.id),
    ),
  ]
  const result = await db
    .batch(statements)
    .catch((cause) => new DatabaseFailureError({ operation: "asset creation", cause }))
  if (result instanceof Error) return result
  if (result.some((entry) => !entry.success)) {
    return new DatabaseFailureError({ operation: "asset creation" })
  }

  return requireAsset({ db, id: asset.id })
}

export async function setAssetLifecycle({
  db,
  id,
  input,
  now,
}: {
  db: D1Database
  id: string
  input: AssetLifecycleInput
  now: Date
}) {
  const archivedAt = input.tag === "archived" ? now.toISOString() : null
  const result = await db
    .prepare("UPDATE assets SET archived_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(archivedAt, id)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "asset lifecycle update", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "asset lifecycle update" })
  if (result.meta.changes === 0) return new AssetNotFoundError({ id })
  return requireAsset({ db, id })
}

export async function replaceAssetTags({
  db,
  id,
  tagSlugs,
}: {
  db: D1Database
  id: string
  tagSlugs: string[]
}) {
  const asset = await requireAsset({ db, id })
  if (asset instanceof Error) return asset
  const tags = await requireTagsBySlugs({ db, slugs: Array.from(new Set(tagSlugs)) })
  if (tags instanceof Error) return tags

  const statements = [
    db.prepare("DELETE FROM asset_tags WHERE asset_id = ?").bind(id),
    ...tags.map((tag) =>
      db.prepare("INSERT INTO asset_tags (asset_id, tag_id) VALUES (?, ?)").bind(id, tag.id),
    ),
  ]
  const result = await db
    .batch(statements)
    .catch((cause) => new DatabaseFailureError({ operation: "asset tag replacement", cause }))
  if (result instanceof Error) return result
  if (result.some((entry) => !entry.success)) {
    return new DatabaseFailureError({ operation: "asset tag replacement" })
  }
  return requireAsset({ db, id })
}

export async function beginAssetDeletion({
  db,
  id,
  now,
}: {
  db: D1Database
  id: string
  now: Date
}) {
  const record = await findAssetStorageRecord({ db, id })
  if (record instanceof Error) return record
  if (record.tag === "missing") return new AssetNotFoundError({ id })

  const result = await db
    .prepare("UPDATE assets SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?")
    .bind(now.toISOString(), id)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "asset deletion start", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "asset deletion start" })
  return { tag: "deleting" as const, objectKey: record.value.object_key }
}

export async function purgeDeletedAsset({ db, id }: { db: D1Database; id: string }) {
  const result = await db
    .prepare("DELETE FROM assets WHERE id = ? AND deleted_at IS NOT NULL")
    .bind(id)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "asset deletion finalization", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "asset deletion finalization" })
  if (result.meta.changes === 0) return new AssetNotFoundError({ id })
  return { tag: "deleted" as const, id }
}

async function findTagBySlug({ db, slug }: { db: D1Database; slug: string }) {
  return readFirst({
    statement: db
      .prepare("SELECT id, name, slug, guidance, created_at FROM tags WHERE slug = ?")
      .bind(slug),
    schema: TagRowSchema,
    operation: "tag slug lookup",
  })
}

export async function createTag({
  db,
  input,
  now,
}: {
  db: D1Database
  input: TagInput
  now: Date
}) {
  const existing = await findTagBySlug({ db, slug: input.slug })
  if (existing instanceof Error) return existing
  if (existing.tag === "found") return new TagConflictError({ slug: input.slug })

  const tag = TagSchema.parse({ id: crypto.randomUUID(), ...input, createdAt: now.toISOString() })
  const result = await db
    .prepare("INSERT INTO tags (id, name, slug, guidance, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(tag.id, tag.name, tag.slug, tag.guidance, tag.createdAt)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "tag creation", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "tag creation" })
  return tag
}

export async function updateTag({
  db,
  id,
  input,
}: {
  db: D1Database
  id: string
  input: TagInput
}) {
  const existing = await readFirst({
    statement: db
      .prepare("SELECT id, name, slug, guidance, created_at FROM tags WHERE id = ?")
      .bind(id),
    schema: TagRowSchema,
    operation: "tag lookup",
  })
  if (existing instanceof Error) return existing
  if (existing.tag === "missing") return new TagNotFoundError({ id })

  const slugOwner = await findTagBySlug({ db, slug: input.slug })
  if (slugOwner instanceof Error) return slugOwner
  if (slugOwner.tag === "found" && slugOwner.value.id !== id) {
    return new TagConflictError({ slug: input.slug })
  }

  const result = await db
    .prepare("UPDATE tags SET name = ?, slug = ?, guidance = ? WHERE id = ?")
    .bind(input.name, input.slug, input.guidance, id)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "tag update", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "tag update" })

  return TagSchema.parse({ ...input, id, createdAt: existing.value.created_at })
}

export async function deleteTag({ db, id }: { db: D1Database; id: string }) {
  const result = await db
    .prepare("DELETE FROM tags WHERE id = ?")
    .bind(id)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "tag deletion", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "tag deletion" })
  if (result.meta.changes === 0) return new TagNotFoundError({ id })
  return { tag: "deleted" as const, id }
}
