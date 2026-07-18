import * as errore from "errore"
import { InternalFailureError } from "../errors"

const TOKEN_BYTE_LENGTH = 32
const DISPLAY_PREFIX_LENGTH = 12

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

export async function hashCapabilityToken({
  token,
  operation,
}: {
  token: string
  operation: string
}) {
  const digest = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(token))
    .catch((cause) => new InternalFailureError({ operation, cause }))
  if (digest instanceof Error) return digest
  return encodeHex(digest)
}

export async function createCapabilityTokenMaterial({
  tokenPrefix,
  operation,
  randomBytes = secureRandomBytes,
}: {
  tokenPrefix: string
  operation: string
  randomBytes?: () => Uint8Array
}) {
  const bytes = errore.try({
    try: randomBytes,
    catch: (cause) => new InternalFailureError({ operation, cause }),
  })
  if (bytes instanceof Error) return bytes
  if (bytes.byteLength !== TOKEN_BYTE_LENGTH) return new InternalFailureError({ operation })

  const token = `${tokenPrefix}${encodeBase64Url(bytes)}`
  const tokenHash = await hashCapabilityToken({ token, operation: `${operation} hashing` })
  if (tokenHash instanceof Error) return tokenHash
  return { token, tokenHash, prefix: token.slice(0, DISPLAY_PREFIX_LENGTH) }
}
