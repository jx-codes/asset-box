import * as errore from "errore"
import { z } from "zod"
import { InternalFailureError } from "../errors"

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 30

const SessionPayloadSchema = z.object({
  tag: z.literal("asset-box-session"),
  expiresAt: z.number().int().positive(),
})

function encodeBase64Url(value: Uint8Array) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function decodeBase64Url(value: string) {
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`
  return errore.try({
    try: () => Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
    catch: (cause) => new InternalFailureError({ operation: "session decoding", cause }),
  })
}

async function importSigningKey(secret: string) {
  return crypto.subtle
    .importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ])
    .catch((cause) => new InternalFailureError({ operation: "session key import", cause }))
}

export async function createSessionToken({ secret, now }: { secret: string; now: Date }) {
  const payload = JSON.stringify({
    tag: "asset-box-session",
    expiresAt: Math.floor(now.getTime() / 1000) + SESSION_LIFETIME_SECONDS,
  })
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(payload))
  const key = await importSigningKey(secret)
  if (key instanceof Error) return key

  const signature = await crypto.subtle
    .sign("HMAC", key, new TextEncoder().encode(encodedPayload))
    .catch((cause) => new InternalFailureError({ operation: "session signing", cause }))
  if (signature instanceof Error) return signature

  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`
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
  const [encodedPayload, encodedSignature, ...remainder] = token.split(".")
  if (!encodedPayload || !encodedSignature || remainder.length > 0) return false

  const signature = decodeBase64Url(encodedSignature)
  if (signature instanceof Error) return false

  const key = await importSigningKey(secret)
  if (key instanceof Error) return key

  const verified = await crypto.subtle
    .verify("HMAC", key, signature, new TextEncoder().encode(encodedPayload))
    .catch((cause) => new InternalFailureError({ operation: "session verification", cause }))
  if (verified instanceof Error) return verified
  if (!verified) return false

  const payloadBytes = decodeBase64Url(encodedPayload)
  if (payloadBytes instanceof Error) return false

  const payload = errore.try({
    try: () => SessionPayloadSchema.parse(JSON.parse(new TextDecoder().decode(payloadBytes))),
    catch: (cause) => new InternalFailureError({ operation: "session parsing", cause }),
  })
  if (payload instanceof Error) return false

  return payload.expiresAt > Math.floor(now.getTime() / 1000)
}

export const sessionCookieOptions = {
  httpOnly: true,
  maxAge: SESSION_LIFETIME_SECONDS,
  path: "/",
  sameSite: "Strict" as const,
  secure: true,
}
