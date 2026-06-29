-- PushKit VoIP tokens for the native iOS app.
--
-- Separate transport from apns_tokens: PushKit issues a *distinct* token used
-- only for VoIP pushes (apns-push-type: voip, topic <bundleId>.voip). These wake
-- the app when backgrounded/terminated so it can report an incoming call to
-- CallKit. Kept in its own table so the existing apns_tokens flow is untouched.
CREATE TABLE IF NOT EXISTS voip_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_digest TEXT NOT NULL,
  device_id TEXT,
  token TEXT NOT NULL UNIQUE,        -- PushKit VoIP token (hex)
  topic TEXT,                        -- <bundle id>.voip; defaults to env APNS_TOPIC + '.voip'
  environment TEXT NOT NULL DEFAULT 'production',  -- 'production' | 'sandbox'
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_voip_account ON voip_tokens(account_digest);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voip_token ON voip_tokens(token);
