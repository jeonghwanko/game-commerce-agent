-- Additive replay receipts only. No existing schema, state or history rewritten.
-- Receipts retain intent, never a cached entitlement/game response.
CREATE TABLE sites_equip_requests (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  PRIMARY KEY(user_id, request_id)
);
