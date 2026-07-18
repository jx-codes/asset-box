PRAGMA foreign_keys = ON;

CREATE TABLE work_requests (
  id TEXT PRIMARY KEY,
  parent_asset_id TEXT REFERENCES assets(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  blurb TEXT NOT NULL CHECK (length(blurb) BETWEEN 1 AND 280),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE request_comments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  resolved_at TEXT,
  resolved_by_asset_id TEXT REFERENCES assets(id),
  CHECK (
    (resolved_at IS NULL AND resolved_by_asset_id IS NULL)
    OR
    (submitted_at IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by_asset_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE work_claims (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  service_token_id TEXT NOT NULL REFERENCES service_tokens(id),
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  result_idempotency_key TEXT NOT NULL UNIQUE,
  completed_at TEXT
) STRICT;

CREATE TABLE claim_comments (
  claim_id TEXT NOT NULL REFERENCES work_claims(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES request_comments(id),
  PRIMARY KEY (claim_id, comment_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE asset_revisions (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  parent_asset_id TEXT REFERENCES assets(id),
  request_id TEXT NOT NULL REFERENCES work_requests(id),
  claim_id TEXT NOT NULL UNIQUE REFERENCES work_claims(id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE work_results (
  claim_id TEXT PRIMARY KEY REFERENCES work_claims(id),
  request_id TEXT NOT NULL REFERENCES work_requests(id),
  service_token_id TEXT NOT NULL REFERENCES service_tokens(id),
  asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX work_requests_parent_created_idx
  ON work_requests(parent_asset_id, created_at DESC);
CREATE INDEX request_comments_actionable_idx
  ON request_comments(request_id, submitted_at, resolved_at, created_at);
CREATE INDEX work_claims_request_expiration_idx
  ON work_claims(request_id, expires_at DESC);
CREATE INDEX work_claims_principal_idx
  ON work_claims(service_token_id, claimed_at DESC);
