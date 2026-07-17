PRAGMA foreign_keys = ON;

CREATE TABLE assets (
  id TEXT PRIMARY KEY CHECK (length(id) = 64),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  blurb TEXT NOT NULL CHECK (length(blurb) BETWEEN 1 AND 280),
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 40),
  guidance TEXT NOT NULL CHECK (length(guidance) BETWEEN 1 AND 280),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, tag_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX assets_created_at_idx ON assets(created_at DESC);
CREATE INDEX asset_tags_tag_id_idx ON asset_tags(tag_id);
