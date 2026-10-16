-- Idempotent AI requests: no raw prompts, provider payloads, identity or secrets.
-- Pending rows never retry automatically after a crash or uncertain outcome.
CREATE TABLE sites_ai_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY(user_id, request_id)
);
