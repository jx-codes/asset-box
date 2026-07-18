CREATE TABLE public_shares (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  token_prefix TEXT NOT NULL CHECK (length(token_prefix) = 12),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at TEXT,
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_downloaded_at TEXT,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (
    (view_count = 0 AND last_viewed_at IS NULL)
    OR (view_count > 0 AND last_viewed_at IS NOT NULL AND last_viewed_at >= created_at)
  ),
  CHECK (
    (download_count = 0 AND last_downloaded_at IS NULL)
    OR (
      download_count > 0
      AND last_downloaded_at IS NOT NULL
      AND last_downloaded_at >= created_at
    )
  )
) STRICT;

CREATE INDEX public_shares_asset_created_idx
  ON public_shares(asset_id, created_at DESC);

CREATE TRIGGER public_shares_revoke_deleted_asset
AFTER UPDATE OF deleted_at ON assets
WHEN NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE public_shares
  SET revoked_at = COALESCE(revoked_at, NEW.deleted_at)
  WHERE asset_id = NEW.id;
END;
