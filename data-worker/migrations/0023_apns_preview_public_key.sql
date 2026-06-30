-- E2E push preview for the native iOS path.
-- Mirror push_subscriptions.preview_public_key onto apns_tokens so senders can
-- encrypt a per-device notification preview that the iOS Notification Service
-- Extension decrypts (P-256 ECDH + HKDF-SHA256 + AES-256-GCM). The server only
-- ever stores/relays the recipient's PUBLIC key and opaque ciphertext.
ALTER TABLE apns_tokens ADD COLUMN preview_public_key TEXT;
