#!/usr/bin/env bash
# ==============================================================================
# setup-environments.sh
# 一鍵設定 Production 環境
# 包含：GitHub Secrets 設定、Worker Secrets 設定
#
# 前置條件：
#   1. npm install -g wrangler   (已登入或有 CLOUDFLARE_API_TOKEN)
#   2. gh auth login             (已登入 GitHub)
#   3. 本腳本在專案根目錄執行
# ==============================================================================
set -euo pipefail

REPO="SENTRY-Security/SENTRY-Messenger"

# 載入 .env（Production 設定）
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  echo "✅ Loaded .env"
else
  echo "❌ .env not found. Please run from project root."
  exit 1
fi

# 確認關鍵變數已載入
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "❌ CLOUDFLARE_ACCOUNT_ID not found in .env"
  exit 1
fi
echo "✅ Cloudflare Account: $CLOUDFLARE_ACCOUNT_ID"

# ==============================================================================
# Step 1: 設定 GitHub Secrets — Production
# ==============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Step 1: Set GitHub Secrets — Production"
echo "═══════════════════════════════════════════════════════════════"

set_secret() {
  local name="$1"
  local value="$2"
  if [ -n "$value" ]; then
    echo "$value" | gh secret set "$name" --repo "$REPO" 2>/dev/null
    echo "  ✅ $name"
  else
    echo "  ⚠️  $name is empty, skipping"
  fi
}

echo "Setting production secrets..."

# Cloudflare credentials (shared)
set_secret "CLOUDFLARE_ACCOUNT_ID"      "$CLOUDFLARE_ACCOUNT_ID"
set_secret "CLOUDFLARE_EMAIL"           "$CLOUDFLARE_EMAIL"
set_secret "CLOUDFLARE_API_KEY"         "$CLOUDFLARE_API_KEY"
set_secret "CLOUDFLARE_API_TOKEN"       "$CLOUDFLARE_API_TOKEN"

# SSH (VPS) — Production（從 .env 讀取）
set_secret "SSH_HOST"                   "${SSH_HOST:-}"
set_secret "SSH_USERNAME"               "${SSH_USERNAME:-}"
set_secret "SSH_PASSWORD"               "${SSH_PASSWORD:-}"

# Backend config
set_secret "PORT"                       "$PORT"
set_secret "ADMIN_IP_ALLOW"             "$ADMIN_IP_ALLOW"
set_secret "CORS_ORIGIN"                "$CORS_ORIGIN"

# Data API
set_secret "DATA_API_URL"               "$DATA_API_URL"
set_secret "DATA_API_HMAC"              "$DATA_API_HMAC"
set_secret "ACCOUNT_HMAC_KEY"           "$ACCOUNT_HMAC_KEY"
set_secret "INVITE_TOKEN_KEY"           "$INVITE_TOKEN_KEY"

# OPAQUE
set_secret "OPAQUE_OPRF_SEED"           "$OPAQUE_OPRF_SEED"
set_secret "OPAQUE_AKE_PRIV_B64"        "$OPAQUE_AKE_PRIV_B64"
set_secret "OPAQUE_AKE_PUB_B64"         "$OPAQUE_AKE_PUB_B64"
set_secret "OPAQUE_SERVER_ID"           "$OPAQUE_SERVER_ID"

# NTAG424
set_secret "NTAG424_KM"                "$NTAG424_KM"
set_secret "NTAG424_KDF"               "$NTAG424_KDF"
set_secret "NTAG424_SALT"              "$NTAG424_SALT"
set_secret "NTAG424_INFO"              "$NTAG424_INFO"
set_secret "NTAG424_KVER"              "$NTAG424_KVER"

# Portal
set_secret "PORTAL_HMAC_SECRET"         "$PORTAL_HMAC_SECRET"
set_secret "PORTAL_API_ORIGIN"          "$PORTAL_API_ORIGIN"

# WebSocket
set_secret "WS_TOKEN_SECRET"            "$WS_TOKEN_SECRET"

# S3 / R2
set_secret "S3_ENDPOINT"               "$S3_ENDPOINT"
set_secret "S3_REGION"                  "$S3_REGION"
set_secret "S3_BUCKET"                  "$S3_BUCKET"
set_secret "S3_ACCESS_KEY"             "$S3_ACCESS_KEY"
set_secret "S3_SECRET_KEY"             "$S3_SECRET_KEY"
set_secret "SIGNED_PUT_TTL"            "$SIGNED_PUT_TTL"
set_secret "SIGNED_GET_TTL"            "$SIGNED_GET_TTL"

# Upload
set_secret "UPLOAD_MAX_BYTES"           "$UPLOAD_MAX_BYTES"
set_secret "UPLOAD_ALLOWED_TYPES"       "$UPLOAD_ALLOWED_TYPES"

# TURN / SFU
set_secret "TURN_TTL_SECONDS"           "$TURN_TTL_SECONDS"
set_secret "CLOUDFLARE_TURN_TOKEN_ID"   "$CLOUDFLARE_TURN_TOKEN_ID"
set_secret "CLOUDFLARE_TURN_TOKEN_KEY"  "$CLOUDFLARE_TURN_TOKEN_KEY"
set_secret "CLOUDFLARE_SFU_TOKEN_ID"    "$CLOUDFLARE_SFU_TOKEN_ID"
set_secret "CLOUDFLARE_SFU_TOKEN_KEY"   "$CLOUDFLARE_SFU_TOKEN_KEY"

# Auth Keys (multiline)
set_secret "PRIVATE_KEY_PUBLIC_PEM"     "$PRIVATE_KEY_PUBLIC_PEM"

# APNs (native iOS push)
set_secret "APNS_KEY_P8"                "$APNS_KEY_P8"
set_secret "APNS_KEY_ID"                "$APNS_KEY_ID"

echo ""
echo "✅ Production secrets complete"

# ==============================================================================
# Step 2: 設定 Production Worker Secrets (如果還沒設)
# ==============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Step 2: Set Cloudflare Worker Secrets (Production)"
echo "═══════════════════════════════════════════════════════════════"

echo "Setting Worker secrets for message-data (production)..."

set_prod_worker_secret() {
  local name="$1"
  local value="$2"
  if [ -n "$value" ]; then
    echo "$value" | npx -y wrangler@4 secret put "$name" 2>/dev/null && \
      echo "  ✅ $name" || echo "  ⚠️  $name failed (try: echo 'VALUE' | npx -y wrangler@4 secret put $name)"
  fi
}

set_prod_worker_secret "HMAC_SECRET"       "$DATA_API_HMAC"
set_prod_worker_secret "ACCOUNT_HMAC_KEY"  "$ACCOUNT_HMAC_KEY"
# Voucher 簽章驗證公鑰（Portal 以對應私鑰簽發儲值憑證 JWT）
set_prod_worker_secret "PRIVATE_KEY_PUBLIC_PEM" "$PRIVATE_KEY_PUBLIC_PEM"
# APNs（原生 iOS 推播）
set_prod_worker_secret "APNS_KEY_P8" "$APNS_KEY_P8"
set_prod_worker_secret "APNS_KEY_ID" "$APNS_KEY_ID"

echo ""
echo "✅ Production Worker secrets complete"

# ==============================================================================
# Summary
# ==============================================================================
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " 🎉 Setup Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo " Production (main branch):"
echo "   Worker:  message-data"
echo "   D1:      message_db (99728586-d8a9-4525-a1af-e68e84594047)"
echo "   Pages:   message-web-hybrid (production deployment)"
echo "   Backend: message-api on port $PORT"
echo ""
echo " ⚠️  記得手動確認/調整以下項目："
echo "   1. SSH_HOST / SSH_USERNAME / SSH_PASSWORD — 如果 .env 中沒有定義"
echo "   2. 如果 Worker 還有其他 secret bindings，請手動補設"
echo ""
