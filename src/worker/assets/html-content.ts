import { InvalidInputError, StorageFailureError } from "../errors"

export const MAX_ASSET_BYTES = 5 * 1024 * 1024

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function validateHtmlBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) return new InvalidInputError({ reason: "The HTML document is empty" })
  if (bytes.byteLength > MAX_ASSET_BYTES) {
    return new InvalidInputError({ reason: "The HTML document must be 5 MB or smaller" })
  }

  const prefix = new TextDecoder().decode(bytes.slice(0, 4096)).trimStart().toLowerCase()
  if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html")) {
    return { tag: "valid-html" as const }
  }
  return new InvalidInputError({
    reason: "The HTML must be a complete document starting with <!doctype html> or <html>",
  })
}

export async function hashAssetBytes(bytes: Uint8Array) {
  const digest = await crypto.subtle
    .digest("SHA-256", bytes)
    .catch((cause) => new StorageFailureError({ operation: "content hashing", cause }))
  if (digest instanceof Error) return digest
  return toHex(new Uint8Array(digest))
}
