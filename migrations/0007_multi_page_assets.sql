PRAGMA foreign_keys = ON;

CREATE TABLE asset_files (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 240),
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
  PRIMARY KEY (asset_id, path)
) STRICT, WITHOUT ROWID;

INSERT INTO asset_files (asset_id, path, object_key, size_bytes, content_sha256)
SELECT id, 'index.html', object_key, size_bytes, id
FROM assets;

CREATE INDEX asset_files_asset_id_idx ON asset_files(asset_id, path);
