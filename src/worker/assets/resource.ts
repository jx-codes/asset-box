import { AssetFilePathSchema } from "@/shared/domain"
import { InvalidInputError } from "../errors"
import type { StorageFailureError } from "../errors"
import { hashAssetBytes, MAX_ASSET_BYTES, validateHtmlBytes } from "./html-content"

export const MAX_ASSET_FILES = 50
export const ASSET_ENTRY_PATH = "index.html"

export type AssetResourceFile = {
  path: string
  bytes: Uint8Array
}

export type StoredAssetFile = {
  path: string
  objectKey: string
  sizeBytes: number
  contentSha256: string
}

function encodeLength(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

function concatBytes(parts: Uint8Array[]) {
  const byteLength = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(byteLength)
  parts.reduce((offset, part) => {
    result.set(part, offset)
    return offset + part.byteLength
  }, 0)
  return result
}

export function resolveAssetRequestPath(path: string | undefined) {
  const candidate =
    path === undefined || path.length === 0
      ? ASSET_ENTRY_PATH
      : path.endsWith("/")
        ? `${path}${ASSET_ENTRY_PATH}`
        : path
  const parsed = AssetFilePathSchema.safeParse(candidate)
  if (!parsed.success) return new InvalidInputError({ reason: "Asset file path is invalid" })
  return parsed.data
}

export function validateAssetResource(files: AssetResourceFile[]) {
  if (files.length === 0)
    return new InvalidInputError({ reason: "At least one HTML file is required" })
  if (files.length > MAX_ASSET_FILES) {
    return new InvalidInputError({
      reason: `An asset can contain at most ${MAX_ASSET_FILES} HTML files`,
    })
  }

  const parsedPaths = files.map((file) => AssetFilePathSchema.safeParse(file.path))
  const invalidPath = parsedPaths.find((result) => !result.success)
  if (invalidPath && !invalidPath.success) {
    return new InvalidInputError({
      reason: invalidPath.error.issues[0]?.message ?? "File path is invalid",
    })
  }

  const paths = files.map((file) => file.path)
  if (new Set(paths).size !== paths.length) {
    return new InvalidInputError({ reason: "Asset file paths must be unique" })
  }
  if (!paths.includes(ASSET_ENTRY_PATH)) {
    return new InvalidInputError({ reason: `Multi-page assets must include ${ASSET_ENTRY_PATH}` })
  }

  const totalBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0)
  if (totalBytes > MAX_ASSET_BYTES) {
    return new InvalidInputError({ reason: "All HTML files together must be 5 MB or smaller" })
  }

  const invalidHtml = files
    .map((file) => validateHtmlBytes(file.bytes))
    .find((result) => result instanceof Error)
  if (invalidHtml instanceof Error) return invalidHtml
  return { tag: "valid-asset-resource" as const, totalBytes }
}

export async function hashAssetResource(files: AssetResourceFile[]) {
  const valid = validateAssetResource(files)
  if (valid instanceof Error) return valid

  const encoder = new TextEncoder()
  const parts = [encoder.encode("asset-box-resource-v1\0")]
  for (const file of [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )) {
    const pathBytes = encoder.encode(file.path)
    parts.push(
      encodeLength(pathBytes.byteLength),
      pathBytes,
      encodeLength(file.bytes.byteLength),
      file.bytes,
    )
  }
  return hashAssetBytes(concatBytes(parts))
}

export async function storedAssetFiles({
  assetId,
  files,
}: {
  assetId: string
  files: AssetResourceFile[]
}): Promise<StorageFailureError | StoredAssetFile[]> {
  const records: StoredAssetFile[] = []
  for (const file of files) {
    const contentSha256 = await hashAssetBytes(file.bytes)
    if (contentSha256 instanceof Error) return contentSha256
    records.push({
      path: file.path,
      objectKey: `assets/${assetId}/${file.path}`,
      sizeBytes: file.bytes.byteLength,
      contentSha256,
    })
  }
  return records
}
