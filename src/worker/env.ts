export type Env = {
  ASSETS: Fetcher
  ASSET_BOX_BUCKET: R2Bucket
  ASSET_BOX_DB: D1Database
  ASSET_BOX_PASSWORD: string
  SESSION_SECRET: string
  COORDINATOR: DurableObjectNamespace
}
