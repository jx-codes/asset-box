ALTER TABLE work_claims
  ADD COLUMN failed_at TEXT;

ALTER TABLE work_claims
  ADD COLUMN failure_reason TEXT
  CHECK (failure_reason IS NULL OR length(trim(failure_reason)) BETWEEN 1 AND 4000);

ALTER TABLE work_claims
  ADD COLUMN resubmitted_at TEXT;

CREATE TRIGGER work_claims_valid_failure_on_insert
BEFORE INSERT ON work_claims
WHEN
  (NEW.failed_at IS NULL AND NEW.failure_reason IS NOT NULL)
  OR (NEW.failed_at IS NOT NULL AND NEW.failure_reason IS NULL)
  OR (NEW.completed_at IS NOT NULL AND NEW.failed_at IS NOT NULL)
  OR (NEW.resubmitted_at IS NOT NULL AND NEW.failed_at IS NULL)
  OR (NEW.failed_at IS NOT NULL AND NEW.failed_at < NEW.claimed_at)
  OR (NEW.resubmitted_at IS NOT NULL AND NEW.resubmitted_at < NEW.failed_at)
BEGIN
  SELECT RAISE(ABORT, 'invalid work claim failure lifecycle');
END;

CREATE TRIGGER work_claims_valid_failure_on_update
BEFORE UPDATE OF completed_at, failed_at, failure_reason, resubmitted_at ON work_claims
WHEN
  (NEW.failed_at IS NULL AND NEW.failure_reason IS NOT NULL)
  OR (NEW.failed_at IS NOT NULL AND NEW.failure_reason IS NULL)
  OR (NEW.completed_at IS NOT NULL AND NEW.failed_at IS NOT NULL)
  OR (NEW.resubmitted_at IS NOT NULL AND NEW.failed_at IS NULL)
  OR (NEW.failed_at IS NOT NULL AND NEW.failed_at < NEW.claimed_at)
  OR (NEW.resubmitted_at IS NOT NULL AND NEW.resubmitted_at < NEW.failed_at)
BEGIN
  SELECT RAISE(ABORT, 'invalid work claim failure lifecycle');
END;
