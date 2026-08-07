export const ASSET_PREVIEW_ROUTE_SEGMENT = "_preview"

export function assetPreviewPath({
  assetId,
  token,
  path = "",
}: {
  assetId: string
  token: string
  path?: string
}) {
  const root = `/view/${assetId}/${ASSET_PREVIEW_ROUTE_SEGMENT}/${encodeURIComponent(token)}/`
  if (path.length === 0) return root
  const encodedPath = path.split("/").map(encodeURIComponent).join("/")
  return `${root}${encodedPath}`
}

export type AssetViewRequest =
  | { tag: "invalid-asset-view-request" }
  | { tag: "asset-view-request"; path: string }

export type AssetPreviewRequest =
  | { tag: "invalid-preview-request" }
  | { tag: "asset-preview-request"; token: string; path: string }

function decodeRequestPath(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

export function parseAssetViewRequest({
  requestPath,
  assetId,
}: {
  requestPath: string
  assetId: string
}): AssetViewRequest {
  const prefix = `/view/${assetId}/`
  if (!requestPath.startsWith(prefix)) return { tag: "invalid-asset-view-request" }
  const path = decodeRequestPath(requestPath.slice(prefix.length))
  if (path === undefined) return { tag: "invalid-asset-view-request" }
  return { tag: "asset-view-request", path }
}

export function parseAssetPreviewRequest({
  requestPath,
  assetId,
}: {
  requestPath: string
  assetId: string
}): AssetPreviewRequest {
  const prefix = `/view/${assetId}/${ASSET_PREVIEW_ROUTE_SEGMENT}/`
  if (!requestPath.startsWith(prefix)) return { tag: "invalid-preview-request" }
  const remainder = decodeRequestPath(requestPath.slice(prefix.length))
  if (remainder === undefined) return { tag: "invalid-preview-request" }
  const [token, ...pathSegments] = remainder.split("/")
  if (!token) return { tag: "invalid-preview-request" }
  return { tag: "asset-preview-request", token, path: pathSegments.join("/") }
}
