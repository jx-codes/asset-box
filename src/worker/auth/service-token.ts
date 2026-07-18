import * as errore from "errore"
import { ServiceTokenSecretSchema } from "@/shared/domain"
import { InternalFailureError } from "../errors"

const TOKEN_BYTE_LENGTH = 32
const PREFIX_LENGTH = 12

function encodeBase64Url(value: Uint8Array) {
  const binary = Array.from(value, (byte) => String.fromCharCode(byte)).join("")
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

function encodeHex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function secureRandomBytes() {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH)
  crypto.getRandomValues(bytes)
  return bytes
}

export function isServiceToken(value: string) {
  return ServiceTokenSecretSchema.safeParse(value).success
}

export async function hashServiceToken(token: string) {
  const digest = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(token))
    .catch((cause) => new InternalFailureError({ operation: "service token hashing", cause }))
  if (digest instanceof Error) return digest
  return encodeHex(digest)
}

export async function createServiceTokenMaterial({
  randomBytes = secureRandomBytes,
}: {
  randomBytes?: () => Uint8Array
} = {}) {
  const bytes = errore.try({
    try: randomBytes,
    catch: (cause) =>
      new InternalFailureError({ operation: "service token random generation", cause }),
  })
  if (bytes instanceof Error) return bytes
  if (bytes.byteLength !== TOKEN_BYTE_LENGTH) {
    return new InternalFailureError({ operation: "service token random generation" })
  }

  const token = `abx_${encodeBase64Url(bytes)}`
  const tokenHash = await hashServiceToken(token)
  if (tokenHash instanceof Error) return tokenHash

  return { token, tokenHash, prefix: token.slice(0, PREFIX_LENGTH) }
}
