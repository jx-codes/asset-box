import * as errore from "errore"
import { z } from "zod"
import { AssetIdSchema } from "@/shared/domain"
import { InternalFailureError } from "../errors"

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30
const ASSET_PREVIEW_LIFETIME_SECONDS = 60 * 60

const SessionPayloadSchema = z.object({
  tag: z.literal("asset-box-session"),
  expiresAt: z.number().int().positive(),
})

const AssetPreviewPayloadSchema = z.object({
  tag: z.literal("asset-box-preview"),
  assetId: AssetIdSchema,
  expiresAt: z.number().int().positive(),
})

function encodeBase64Url(value: Uint8Array) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function decodeBase64Url(value: string, operation: string) {
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`
  return errore.try({
    try: () => Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    catch: (cause) => new InternalFailureError({ operation, cause }),
  })
}

async function importSigningKey(secret: string, operation: string) {
  return crypto.subtle
    .importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ])
    .catch((cause) => new InternalFailureError({ operation, cause }))
}

async function createSignedToken({
  payload,
  secret,
  operation,
}: {
  payload: object
  secret: string
  operation: string
}) {
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const key = await importSigningKey(secret, `${operation} key import`)
  if (key instanceof Error) return key

  const signature = await crypto.subtle
    .sign("HMAC", key, new TextEncoder().encode(encodedPayload))
    .catch((cause) => new InternalFailureError({ operation, cause }))
  if (signature instanceof Error) return signature

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`
}

async function verifySignedToken<T>({
  token,
  secret,
  schema,
  operation,
}: {
  token: string
  secret: string
  schema: z.ZodType<T>
  operation: string
}) {
  const [encodedPayload, encodedSignature, ...remainder] = token.split(".")
  if (!encodedPayload || !encodedSignature || remainder.length > 0) return false

  const signature = decodeBase64Url(encodedSignature, `${operation} signature decoding`)
  if (signature instanceof Error) return false

  const key = await importSigningKey(secret, `${operation} key import`)
  if (key instanceof Error) return key

  const verified = await crypto.subtle
    .verify("HMAC", key, signature, new TextEncoder().encode(encodedPayload))
    .catch((cause) => new InternalFailureError({ operation, cause }))
  if (verified instanceof Error) return verified
  if (!verified) return false

  const payloadBytes = decodeBase64Url(encodedPayload, `${operation} payload decoding`)
  if (payloadBytes instanceof Error) return false

  const payload = errore.try({
    try: () => schema.parse(JSON.parse(new TextDecoder().decode(payloadBytes))),
    catch: (cause) => new InternalFailureError({ operation: `${operation} parsing`, cause }),
  })
  if (payload instanceof Error) return false
  return payload
}

export async function createSessionToken({ secret, now }: { secret: string; now: Date }) {
  return createSignedToken({
    payload: {
      tag: "asset-box-session",
      expiresAt: Math.floor(now.getTime() / 1000) + SESSION_LIFETIME_SECONDS,
    },
    secret,
    operation: "session signing",
  })
}

export async function verifySessionToken({
  token,
  secret,
  now,
}: {
  token: string
  secret: string
  now: Date
}) {
  const payload = await verifySignedToken({
    token,
    secret,
    schema: SessionPayloadSchema,
    operation: "session verification",
  })
  if (payload instanceof Error || payload === false) return payload
  return payload.expiresAt > Math.floor(now.getTime() / 1000)
}

export async function createAssetPreviewToken({
  assetId,
  secret,
  now,
}: {
  assetId: string
  secret: string
  now: Date
}) {
  return createSignedToken({
    payload: {
      tag: "asset-box-preview",
      assetId,
      expiresAt: Math.floor(now.getTime() / 1000) + ASSET_PREVIEW_LIFETIME_SECONDS,
    },
    secret,
    operation: "asset preview signing",
  })
}

export async function verifyAssetPreviewToken({
  token,
  assetId,
  secret,
  now,
}: {
  token: string
  assetId: string
  secret: string
  now: Date
}) {
  const payload = await verifySignedToken({
    token,
    secret,
    schema: AssetPreviewPayloadSchema,
    operation: "asset preview verification",
  })
  if (payload instanceof Error || payload === false) return payload
  return payload.assetId === assetId && payload.expiresAt > Math.floor(now.getTime() / 1000)
}

export const sessionCookieOptions = {
  httpOnly: true,
  maxAge: SESSION_LIFETIME_SECONDS,
  path: "/",
  sameSite: "Strict" as const,
  secure: true,
}
