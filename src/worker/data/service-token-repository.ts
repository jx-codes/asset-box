import * as errore from "errore"
import { z } from "zod"
import { ServiceTokenSchema, type ServiceToken, type ServiceTokenInput } from "@/shared/domain"
import { DatabaseFailureError, ServiceTokenNotFoundError } from "../errors"

const ServiceTokenRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
})

const AuthenticatedTokenRowSchema = z.object({ id: z.string() })

type ServiceTokenRow = z.infer<typeof ServiceTokenRowSchema>

type Lookup<T> = { tag: "found"; value: T } | { tag: "missing" }

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

function toServiceToken({ row, now }: { row: ServiceTokenRow; now: Date }): ServiceToken {
  const status: ServiceToken["status"] = (() => {
    if (row.revoked_at !== null) return { tag: "revoked", revokedAt: row.revoked_at }
    if (row.expires_at !== null && row.expires_at <= now.toISOString()) {
      return { tag: "expired", expiredAt: row.expires_at }
    }
    if (row.expires_at !== null) {
      return {
        tag: "active",
        expiration: { tag: "scheduled", expiresAt: row.expires_at },
      }
    }
    return { tag: "active", expiration: { tag: "never" } }
  })()

  return ServiceTokenSchema.parse({
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.created_at,
    usage:
      row.last_used_at === null
        ? { tag: "never-used" }
        : { tag: "used", lastUsedAt: row.last_used_at },
    status,
  })
}

export async function listServiceTokens({ db, now }: { db: D1Database; now: Date }) {
  const result = await db
    .prepare(
      `SELECT id, name, prefix, created_at, last_used_at, expires_at, revoked_at
       FROM service_tokens ORDER BY created_at DESC`,
    )
    .all()
    .catch((cause) => new DatabaseFailureError({ operation: "service token listing", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "service token listing" })

  const rows = errore.try({
    try: () => z.array(ServiceTokenRowSchema).parse(result.results),
    catch: (cause) =>
      new DatabaseFailureError({ operation: "service token listing result parsing", cause }),
  })
  if (rows instanceof Error) return rows
  return { serviceTokens: rows.map((row) => toServiceToken({ row, now })) }
}

export async function insertServiceToken({
  db,
  id,
  input,
  prefix,
  tokenHash,
  now,
}: {
  db: D1Database
  id: string
  input: ServiceTokenInput
  prefix: string
  tokenHash: string
  now: Date
}) {
  const createdAt = now.toISOString()
  const result = await db
    .prepare(
      `INSERT INTO service_tokens
         (id, name, prefix, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, prefix, tokenHash, createdAt, input.expiresAt ?? null)
    .run()
    .catch((cause) => new DatabaseFailureError({ operation: "service token creation", cause }))
  if (result instanceof Error) return result
  if (!result.success) return new DatabaseFailureError({ operation: "service token creation" })

  return ServiceTokenSchema.parse({
    id,
    name: input.name,
    prefix,
    createdAt,
    usage: { tag: "never-used" },
    status: {
      tag: "active",
      expiration:
        input.expiresAt === undefined
          ? { tag: "never" }
          : { tag: "scheduled", expiresAt: input.expiresAt },
    },
  })
}

export async function authenticateServiceTokenHash({
  db,
  tokenHash,
  now,
}: {
  db: D1Database
  tokenHash: string
  now: Date
}) {
  const usedAt = now.toISOString()
  return readFirst({
    statement: db
      .prepare(
        `UPDATE service_tokens SET last_used_at = ?
         WHERE token_hash = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         RETURNING id`,
      )
      .bind(usedAt, tokenHash, usedAt),
    schema: AuthenticatedTokenRowSchema,
    operation: "service token authentication",
  })
}

export async function revokeServiceToken({
  db,
  id,
  now,
}: {
  db: D1Database
  id: string
  now: Date
}) {
  const result = await readFirst({
    statement: db
      .prepare(
        `UPDATE service_tokens SET revoked_at = COALESCE(revoked_at, ?)
         WHERE id = ?
         RETURNING id, name, prefix, created_at, last_used_at, expires_at, revoked_at`,
      )
      .bind(now.toISOString(), id),
    schema: ServiceTokenRowSchema,
    operation: "service token revocation",
  })
  if (result instanceof Error) return result
  if (result.tag === "missing") return new ServiceTokenNotFoundError({ id })
  return toServiceToken({ row: result.value, now })
}
