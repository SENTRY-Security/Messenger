-- APNs device tokens for the native iOS app (and App Clip).
-- Parallel transport to push_subscriptions (Web Push): WKWebView cannot receive
-- Web Push, so the native app registers an APNs token here, keyed by the same
-- account_digest used everywhere else.
CREATE TABLE IF NOT EXISTS apns_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_digest TEXT NOT NULL,
  device_id TEXT,
  token TEXT NOT NULL UNIQUE,        -- APNs device token (hex)
  topic TEXT,                        -- bundle id; defaults to env APNS_TOPIC
  environment TEXT NOT NULL DEFAULT 'production',  -- 'production' | 'sandbox'
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_apns_account ON apns_tokens(account_digest);
CREATE UNIQUE INDEX IF NOT EXISTS idx_apns_token ON apns_tokens(token);
