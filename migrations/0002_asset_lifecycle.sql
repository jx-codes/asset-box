ALTER TABLE assets ADD COLUMN archived_at TEXT;
ALTER TABLE assets ADD COLUMN deleted_at TEXT;

CREATE INDEX assets_lifecycle_idx
  ON assets(deleted_at, archived_at, created_at DESC);
