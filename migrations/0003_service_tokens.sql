CREATE TABLE service_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  prefix TEXT NOT NULL CHECK (length(prefix) = 12),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
) STRICT;

CREATE INDEX service_tokens_created_at_idx
  ON service_tokens(created_at DESC);
