-- Schema only. Apply via the Sites migration pipeline, never in request code.
CREATE TABLE sites_environment (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sites_sessions (user_id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE sites_quotes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, sku TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL, version INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE sites_orders (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE REFERENCES sites_quotes(id), user_id TEXT NOT NULL, sku TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, version INTEGER NOT NULL, provider TEXT NOT NULL, provider_id TEXT UNIQUE, status TEXT NOT NULL CHECK(status IN ('CREATING','APPROVAL_PENDING','CAPTURE_PENDING','AWAITING_WEBHOOK','GRANTED','CANCELLED','FAILED','REVIEW')), capture_id TEXT UNIQUE, capture_verified INTEGER NOT NULL DEFAULT 0, webhook_verified INTEGER NOT NULL DEFAULT 0, review INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, lease_token TEXT, lease_expires INTEGER NOT NULL DEFAULT 0, lease_kind TEXT);
CREATE UNIQUE INDEX sites_one_purchase ON sites_orders(user_id,sku) WHERE status NOT IN ('CANCELLED','FAILED');
CREATE TABLE sites_entitlements (user_id TEXT NOT NULL, sku TEXT NOT NULL, source_order_id TEXT NOT NULL UNIQUE REFERENCES sites_orders(id), status TEXT NOT NULL DEFAULT 'active', PRIMARY KEY(user_id,sku));
CREATE TABLE sites_verified_events (provider TEXT NOT NULL, id TEXT NOT NULL, type TEXT NOT NULL, provider_id TEXT, capture_id TEXT, PRIMARY KEY(provider,id));
CREATE TABLE sites_receipts (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES sites_orders(id));
CREATE TABLE sites_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT, name TEXT NOT NULL, at INTEGER NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sites_game (user_id TEXT PRIMARY KEY, equipped TEXT, borrowed INTEGER NOT NULL DEFAULT 0, seal INTEGER NOT NULL DEFAULT 0, rumor INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sites_challenges (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, quest TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE sites_mock_orders (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, capture_id TEXT);
CREATE TABLE sites_budgets (name TEXT PRIMARY KEY, started INTEGER NOT NULL, used INTEGER NOT NULL, ceiling INTEGER NOT NULL, concurrency INTEGER NOT NULL, window_ms INTEGER NOT NULL);
CREATE TABLE sites_external_work (token TEXT PRIMARY KEY, name TEXT NOT NULL);
-- A transaction-local assertion row makes failed CAS roll back the entire batch.
CREATE TABLE sites_assertions (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
