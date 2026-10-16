-- Operator-only examples; no raw conversations, payment data or external sink.
-- Attempt counts and distinct participating pseudonyms by event (not billed revenue).
SELECT name, count(*) AS attempts, count(DISTINCT user_id) AS players
FROM events GROUP BY name ORDER BY name;

-- Unique local-order conversions. Never sum repeated pending/capture attempts as sales.
SELECT count(*) AS confirmed_orders,
       sum(status = 'GRANTED') AS granted_orders,
       sum(status = 'REVIEW') AS review_orders,
       sum(status = 'CANCELLED') AS cancelled_orders
FROM orders;

-- Outbox backlog and age for an authorized local operator.
SELECT count(*) AS pending_events, min(at) AS oldest_pending_epoch_ms
FROM events WHERE delivered = 0;

-- Example independent sink table: insert idempotently by the source event ID.
-- Use a separate sink DB, not the commerce source DB; acknowledge only AFTER commit.
-- CREATE TABLE received_events (
--   id TEXT PRIMARY KEY, user_id TEXT NOT NULL, order_id TEXT,
--   name TEXT NOT NULL, at INTEGER NOT NULL
-- );
-- INSERT INTO received_events VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING;
