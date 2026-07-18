import * as errore from "errore"
import { z } from "zod"
import {
  type PublicShare,
  PublicShareListSchema,
  PublicShareSchema,
  type PublicShareCreateInput,
} from "@/shared/public-shares"
import {
  DatabaseFailureError,
  PublicShareNotFoundError,
  PublicShareUnavailableError,
} from "../errors"

const PublicShareRowSchema = z.object({
  id: z.string(),
  asset_id: z.string(),
  name: z.string(),
  token_prefix: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  view_count: z.number().int().nonnegative(),
  last_viewed_at: z.string().nullable(),
  download_count: z.number().int().nonnegative(),
  last_downloaded_at: z.string().nullable(),
})

const PublicShareTargetRowSchema = z.object({
  share_id: z.string(),
  asset_id: z.string(),
  title: z.string(),
  blurb: z.string(),
  object_key: z.string(),
})

const PublicShareAccessRowSchema = z.object({ id: z.string() })

type PublicShareRow = z.infer<typeof PublicShareRowSchema>
type Lookup<T> = { tag: "found"; value: T } | { tag: "missing" }

export type PublicShareTarget = z.infer<typeof PublicShareTargetRowSchema>

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

function toPublicShare({ row, now }: { row: PublicShareRow; now: Date }) {
  const status: PublicShare["status"] = (() => {
    if (row.revoked_at !== null) return { tag: "revoked", revokedAt: row.revoked_at }
    if (row.expires_at !== null && row.expires_at <= now.toISOString()) {
      return { tag: "expired", expiredAt: row.expires_at }
    }
    return {
      tag: "active",
      expiration:
        row.expires_at === null
          ? { tag: "never" }
          : { tag: "scheduled", expiresAt: row.expires_at },
    }
  })()

  return errore.try({
    try: () =>
      PublicShareSchema.parse({
        id: row.id,
        assetId: row.asset_id,
        name: row.name,
        prefix: row.token_prefix,
        createdAt: row.created_at,
        status,
        views:
          row.view_count === 0
            ? { tag: "never-viewed" }
            : { tag: "viewed", count: row.view_count, lastViewedAt: row.last_viewed_at },
        downloads:
          row.download_count === 0
            ? { tag: "never-downloaded" }
            : {
                tag: "downloaded",
                count: row.download_count,
                lastDownloadedAt: row.last_downloaded_at,
              },
      }),
    catch: (cause) => new DatabaseFailureError({ operation: "public share row parsing", cause }),
  })
}

export async function listPublicShares({
  db,
  assetId,
  now,
}: {
  db: D1Database
  assetId: string
  now: Date
}) {
  const result = await db
    .prepare(
      `SELECT id, asset_id, name, token_prefix, created_at, expires_at, revoked_at,
        view_count, last_viewed_at, download_count, last_downloaded_at
       FROM public_shares WHERE asset_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .bind(assetId)
    .all()
    .catch((cause) => new DatabaseFailureError({ operation: "public share listing", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "public share listing" })

  const rows = errore.try({
    try: () => z.array(PublicShareRowSchema).parse(result.results),
    catch: (cause) =>
      new DatabaseFailureError({ operation: "public share listing result parsing", cause }),
  })
  if (rows instanceof Error) return rows

  const shares = rows.map((row) => toPublicShare({ row, now }))
  const failure = shares.find((share) => share instanceof Error)
  if (failure instanceof Error) return failure
  return PublicShareListSchema.parse({ publicShares: shares })
}

export async function insertPublicShare({
  db,
  id,
  assetId,
  input,
  prefix,
  tokenHash,
  now,
}: {
  db: D1Database
  id: string
  assetId: string
  input: PublicShareCreateInput
  prefix: string
  tokenHash: string
  now: Date
}) {
  const createdAt = now.toISOString()
  const result = await db
    .prepare(
      `INSERT INTO public_shares
        (id, asset_id, name, token_prefix, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, assetId, input.name, prefix, tokenHash, createdAt, input.expiresAt ?? null)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "public share creation", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "public share creation" })

  return PublicShareSchema.parse({
    id,
    assetId,
    name: input.name,
    prefix,
    createdAt,
    status: {
      tag: "active",
      expiration:
        input.expiresAt === undefined
          ? { tag: "never" }
          : { tag: "scheduled", expiresAt: input.expiresAt },
    },
    views: { tag: "never-viewed" },
    downloads: { tag: "never-downloaded" },
  })
}

export async function revokePublicShare({
  db,
  assetId,
  id,
  now,
}: {
  db: D1Database
  assetId: string
  id: string
  now: Date
}) {
  const result = await readFirst({
    statement: db
      .prepare(
        `UPDATE public_shares SET revoked_at = COALESCE(revoked_at, ?)
         WHERE id = ? AND asset_id = ?
         RETURNING id, asset_id, name, token_prefix, created_at, expires_at, revoked_at,
           view_count, last_viewed_at, download_count, last_downloaded_at`,
      )
      .bind(now.toISOString(), id, assetId),
    schema: PublicShareRowSchema,
    operation: "public share revocation",
  })
  if (result instanceof Error) return result
  if (result.tag === "missing") return new PublicShareNotFoundError({ id })
  return toPublicShare({ row: result.value, now })
}

export async function findActivePublicShareTarget({
  db,
  tokenHash,
  now,
}: {
  db: D1Database
  tokenHash: string
  now: Date
}) {
  const result = await readFirst({
    statement: db
      .prepare(
        `SELECT share.id AS share_id, asset.id AS asset_id, asset.title, asset.blurb, asset.object_key
         FROM public_shares share
         INNER JOIN assets asset ON asset.id = share.asset_id AND asset.deleted_at IS NULL
         WHERE share.token_hash = ? AND share.revoked_at IS NULL
           AND (share.expires_at IS NULL OR share.expires_at > ?)`,
      )
      .bind(tokenHash, now.toISOString()),
    schema: PublicShareTargetRowSchema,
    operation: "public share lookup",
  })
  if (result instanceof Error) return result
  if (result.tag === "missing") return new PublicShareUnavailableError()
  return result.value
}

export async function confirmPublicShareActive({
  db,
  shareId,
  now,
}: {
  db: D1Database
  shareId: string
  now: Date
}) {
  const result = await readFirst({
    statement: db
      .prepare(
        `SELECT id FROM public_shares
         WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .bind(shareId, now.toISOString()),
    schema: PublicShareAccessRowSchema,
    operation: "public share access confirmation",
  })
  if (result instanceof Error) return result
  if (result.tag === "missing") return new PublicShareUnavailableError()
  return { tag: "active" as const, shareId }
}

export async function recordPublicShareAccess({
  db,
  shareId,
  access,
  now,
}: {
  db: D1Database
  shareId: string
  access: "view" | "download"
  now: Date
}) {
  const accessedAt = now.toISOString()
  const update =
    access === "view"
      ? `UPDATE public_shares SET view_count = view_count + 1, last_viewed_at = ?
         WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         RETURNING id`
      : `UPDATE public_shares SET download_count = download_count + 1, last_downloaded_at = ?
         WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         RETURNING id`
  const result = await readFirst({
    statement: db.prepare(update).bind(accessedAt, shareId, accessedAt),
    schema: PublicShareAccessRowSchema,
    operation: `public share ${access} recording`,
  })
  if (result instanceof Error) return result
  if (result.tag === "missing") return new PublicShareUnavailableError()
  return { tag: "recorded" as const, shareId }
}
