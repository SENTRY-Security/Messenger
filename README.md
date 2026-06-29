# SENTRY Messenger

[繁體中文](README.zh-Hant.md) | **English**

Tap to open. Leave to vanish. Communication that leaves no trace.

<p align="center">
  <img src="https://sentry.red/assets/images/424tag.png" alt="SENTRY Messenger" width="600" />
</p>

## Why Not an App?

Traditional messaging apps require installation — leaving icons, notification logs, and entries in app lists permanently on the device. Even after deletion, residual data may be recoverable by forensic tools.

SENTRY Messenger is a pure web application. No installation required.

## How Does It Launch?

Users carry an NFC chip (card, sticker, ring — any form factor) programmed with a dedicated URL. Tap the chip with your phone, the browser opens automatically, enter the password, and you are directly into encrypted communication.

No app icon. No bookmark. No home screen shortcut. The only way to launch is the chip.

## What Happens When You Leave?

When the screen turns off, you switch to another app, or the browser goes to the background — the system immediately:

1. Clears all local data (memory, IndexedDB, LocalStorage)
2. Logs out the account
3. Redirects the browser to a user-configured web page (default: Google)
4. Overwrites browsing history so the back button cannot return

Result: anyone picking up the phone sees an ordinary Google page with no indication the device was just used for encrypted communication.

## Next Time?

Tap the chip again, enter the password. All messages, contacts, and files are instantly restored from server-side encrypted backups. Continue right where you left off.

No persistent data is stored locally. All sensitive data is kept in the cloud with end-to-end encryption. The device is merely a temporary viewing window.

---

**End-to-end encrypted instant messaging system** — built on Signal Protocol (X3DH + Double Ratchet), deployed on a fully serverless Cloudflare Workers architecture.

> Website: https://sentry.red · Version: 0.1.9 · License: AGPL-3.0-only

### Why Open Source?

This project is open-sourced under AGPL-3.0, driven by two core principles:

1. **Sharing design and implementation** — Making the complete engineering practices available to the developer community, including practical Signal Protocol application, a pure-frontend video chunked encryption streaming pipeline (WebCodecs transcoding → per-chunk AES-256-GCM encryption → MSE streaming decryption playback), and Cloudflare Workers + Durable Objects fully serverless deployment experience.
2. **Public security verification** — Trust in an end-to-end encryption system should be built on inspectable code. This project's cryptographic implementations (X3DH key exchange, Double Ratchet, media chunked encryption, key management) are all open for review. The complete [security audit documentation](#security-audit--threat-model) records known limitations and remediation status.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Features](#core-features)
- [Video Call Architecture](#video-call-architecture)
- [Ephemeral Chat](#ephemeral-chat)
- [Chunked Encryption Streaming](#chunked-encryption-streaming)
- [Office Document Viewer](#office-document-viewer)
- [Project Structure](#project-structure)
- [Cryptographic Protocols](#cryptographic-protocols)
- [Message Flow Architecture](#message-flow-architecture)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [WebSocket Real-Time Communication](#websocket-real-time-communication)
- [Web Push Notifications](#web-push-notifications)
- [Security Design Principles](#security-design-principles)
- [Security Audit & Threat Model](#security-audit--threat-model)
- [Horizontal Deployment & Scaling Advantages](#horizontal-deployment--scaling-advantages)
- [Quick Start](#quick-start)
- [Deployment](#deployment)
- [Testing](#testing)
- [Environment Variables](#environment-variables)

---

## Architecture Overview

### Fully Serverless Two-Layer Architecture

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │                     SENTRY Messenger                         │
                    └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────┐                          ┌─────────────────────────────────┐
  │   Frontend (web/)    │                          │  Cloudflare Workers              │
  │                      │                          │  (data-worker/)                  │
  │  Cloudflare Pages    │─── HTTPS / WSS ────────▶│  API + WebSocket (Durable Objects)│
  │  Vanilla JS SPA      │                          │  D1 (SQLite) + R2 + KV           │
  │  esbuild bundler     │                          │                                  │
  └──────────────────────┘                          └─────────────────────────────────┘
         │                                                        │
  ┌──────┴──────┐                                         ┌───────┴───────┐
  │ X3DH + DR   │                                         │ D1 Database   │
  │ Client-side │                                         │ R2 Media Store│
  │ encryption  │                                         │ OPAQUE + SDM  │
  │ IndexedDB   │                                         │ KV Sessions   │
  └─────────────┘                                         │ Durable Objects│
                                                          │  (WebSocket)  │
                                                          └───────────────┘
```

1. **Frontend (`web/`)** — Pure static SPA deployed to Cloudflare Pages; all encryption/decryption is performed client-side
2. **Cloudflare Workers (`data-worker/`)** — Unified backend handling all REST APIs, WebSocket real-time communication (Durable Objects), OPAQUE authentication, SDM verification, key management, with direct access to D1/R2/KV
3. **iOS native shell (`ios/`)** — Wraps the web messenger in a `WKWebView`, adding NTAG424 tap-to-login and an App Clip entry point; XcodeGen project, see `ios/README.md`

> **v0.1.9 Architecture Migration:** The original Node.js Express + WebSocket relay layer (`src/`) has been completely removed. All API endpoints and WebSocket connection management have been migrated to Cloudflare Workers + Durable Objects, achieving a fully serverless architecture. No more VPS, PM2, or any server operations required.

---

## Core Features

### Cryptographic Protocols

| Feature | Technology | Description |
|---------|------------|-------------|
| Key Exchange | X3DH (Extended Triple Diffie-Hellman) | Asynchronously establishes shared secrets with offline initialization support |
| Message Encryption | Double Ratchet | Independent key per message with forward secrecy + backward secrecy |
| Symmetric Encryption | XChaCha20-Poly1305 / AES-256-GCM | AEAD encryption for message content |
| Identity Authentication | Ed25519 Signature + OPAQUE PAKE | Authentication protocol where passwords never traverse the network |
| NFC Authentication | NTAG 424 DNA SDM (CMAC/HKDF/EV2) | Physical NFC tag identity binding |
| Key Derivation | HKDF-SHA256 / Argon2id | Key derivation and password strengthening |
| Master Key Protection | Argon2id + AES-256-GCM wrapping | User password protects the master key |
| Media Chunked Encryption | HKDF-SHA256 → AES-256-GCM per-chunk | Independent key and IV per chunk with info tag domain separation |
| Call E2EE | InsertableStreams + AES-GCM | WebRTC per-frame encryption with counter-based nonce and 1-minute key rotation |
| Push Preview E2EE | ECDH P-256 + HKDF-SHA256 + AES-256-GCM | End-to-end encrypted push notification preview content; server cannot read |

### Communication Features

- **End-to-end encrypted messages** — Text, media, and files are encrypted client-side; the server only relays ciphertext
- **Voice/video calls** — WebRTC P2P + Cloudflare TURN relay with InsertableStreams E2EE media encryption
- **AI face/background blur** — MediaPipe Face Detection three-stage blur (face blur / background blur / off) with three-tier detection strategy (Native FaceDetector → MediaPipe WASM → skin-tone detection)
- **Chunked encryption streaming** — Videos are automatically transcoded to fMP4 on upload, per-chunk AES-256-GCM encryption, MSE/ManagedMediaSource real-time streaming playback (up to 1GB per file), AIMD adaptive concurrency control
- **WebCodecs smart transcoding** — All videos auto-transcoded to 720p/1.5Mbps H.264 fMP4 (4K/1080p auto-downscaled to 720p), non-H.264 formats (HEVC/VP9) auto-transcoded, existing H.264 within limits directly remuxed without transcoding, streaming transcode→encrypt→upload pipeline (low memory footprint)
- **Ephemeral Chat** — One-time encrypted links allowing unregistered guests to join time-limited E2EE conversations (X3DH + Double Ratchet) via browser, supporting text/images/voice-video calls, auto-destruction on countdown expiry, 7-language i18n
- **Contact invitations** — Encrypted Invite Dropbox mechanism (supports offline mutual add + confirmation feedback)
- **Group conversations** — Multi-party encrypted chat rooms with role-based permission management (owner/admin/member)
- **Read receipts** — Commit-driven message status tracking (✓ sent / ✓✓ delivered)
- **Real-time push** — WebSocket real-time message notifications and call signaling (Durable Objects per-account isolation), push preview end-to-end encrypted (ECDH P-256 + AES-256-GCM; server cannot read notification content)
- **Message replay** — Message Key Vault supports historical message playback
- **Contact backup** — Encrypted backup/restore of contact keys to the server
- **Subscription management** — Subscription code redemption, validation, QR scan upload, and quota management
- **Soft deletion** — Message/conversation cursor-based soft deletion (timestamp-driven)
- **Avatar management** — Contact avatar upload/download (Presigned URL + R2)
- **Media preview** — Image viewer, PDF viewer, media permission management
- **Office document viewer** — Word (.doc/.docx), Excel (.xlsx/.xls), PowerPoint (.pptx) pure frontend parsing and rendering with zero server dependency
- **File storage** — Drive Pane file management with folder creation/browsing/upload and quota management (default 3GB)
- **Transfer progress UI** — Dual upload/download progress bars with expandable processing step checklist (format detection → transcoding → encrypted upload), real-time speed and transferred amount display
- **SDM simulation** — Development NFC tag simulation (Sim Chips)
- **Offline sync** — Hybrid Flow offline/online message synchronization with gap detection and backfill
- **Account management** — Admin account purge and forced logout

### Security Features

- **Client-side encryption** — Messages and media are encrypted client-side before leaving the device; the server only stores ciphertext
- **Forward Secrecy** — Double Ratchet derives an independent key for every message, limiting the blast radius of a single key compromise by design
- **Break-in Recovery (Backward Secrecy)** — New DH exchanges produce a new Root Key, designed so that an attacker cannot continue decrypting subsequent messages
- **Anti-replay** — Per-conversation counter with monotonic increment, enforced server-side
- **No Fallback Policy** — Strict cryptographic protocol; refuses any downgrade/retry/rollback
- **Offline key exchange** — X3DH Prekey Bundle enables secure initialization even when the peer is offline
- **Push Preview E2EE** — Push notification preview content (sender name, message summary) is encrypted at the sender's end using the receiver's device public key (ECDH P-256 + AES-256-GCM); the server only relays ciphertext; Service Worker decrypts and displays locally
- **Forced logout** — Account purge triggers real-time ejection of all devices via WebSocket `force-logout`

> **Known Limitations:** Message and media content is encrypted client-side; the server does not hold decryption keys. However, communication metadata (social graph, timestamps, online status, etc.) remains visible to the server. See [Metadata Exposure](docs/security/metadata-exposure.md) and [Known Limitations](docs/security/known-limitations.md) for the full analysis.

---

## Video Call Architecture

### WebRTC P2P Calls

```
  Caller                        Signaling (WebSocket)                     Callee
  ──────                        ─────────────────────                     ──────
    │── call-invite ────────────────────────────────────────────────────▶│
    │◀──────────────────────────────────────────────────── call-ringing ─│
    │◀──────────────────────────────────────────────────── call-accept ──│
    │                                                                    │
    │── SDP offer (+ ICE candidates) ──────────────────────────────────▶│
    │◀──────────────────────────────── SDP answer (+ ICE candidates) ───│
    │                                                                    │
    │◀═══════════════ DTLS/SRTP ═══════════════════════════════════════▶│
    │               WebRTC P2P encrypted media channel (via TURN relay if needed)│
```

- **Architecture**: Pure P2P point-to-point calls (not SFU); WebSocket is used only for signaling exchange
- **ICE**: Full candidate gathering (host + srflx + relay), Cloudflare STUN + dynamic TURN credentials
- **DTLS**: ECDSA P-256 certificates providing transport-layer encryption
- **Media**: Audio (echo cancellation + noise suppression + auto gain control) + Video
- **Safari Compatibility**: Full ICE candidates embedded in SDP, separate `<audio>` element, usernameFragment injection

### E2EE Media Encryption (InsertableStreams)

| Direction | Info Tag | Description |
|-----------|----------|-------------|
| Audio Send | `call-audio-tx:caller` | AES-GCM per-frame encryption |
| Audio Receive | `call-audio-tx:callee` | Peer decryption |
| Video Send | `call-video-tx:caller` | AES-GCM per-frame encryption |
| Video Receive | `call-video-tx:callee` | Peer decryption |

- Independent nonce per frame (counter-based) to prevent replay
- Keys automatically rotated every 1 minute

### MediaPipe Face/Background Blur

```
Camera VideoTrack
  ↓
Hidden <video> element
  ↓
Canvas drawImage (30 FPS)
  ↓
Face Detection (detected every 200ms, results cached)
  ├── Tier 1: Native FaceDetector API (Chrome/Edge 86+)
  ├── Tier 2: MediaPipe Face Detection WASM (Safari/Firefox/iOS)
  │           CDN: @mediapipe/tasks-vision@0.10.14
  │           Model: BlazeFace Short Range TFLite (~1.5MB)
  └── Tier 3: Skin-tone region detection (YCbCr threshold + BFS connected components)
  ↓
Pixelation (28×28 pixel blocks, 35% padding, ±30 color noise)
  ├── FACE mode → Pixelate detected face regions
  ├── BACKGROUND mode → Pixelate all regions outside faces
  └── OFF mode → Pass through without processing
  ↓
canvas.captureStream() → processed VideoTrack
  ↓
RTCRtpSender.replaceTrack() → send processed video
```

- **Browser Support**: Chrome 51+ / Firefox 43+ / Safari 15+ / iOS Safari 15+
- **Safari Heartbeat**: ~33ms heartbeat to keep captureStream alive
- **Mode Switching**: Top-left button in call UI — blue (face) → purple (background) → gray (off)

---

## Ephemeral Chat

A one-time encrypted ephemeral chat system that allows registered users (Owner) to generate a one-time link for external parties (Guest) without the app installed to join a time-limited E2EE conversation via browser. Session data is cleared from the server when the countdown ends or either party closes the page.

### Architecture Overview

```
Owner (In-App)                  Cloudflare Worker                 Guest (Browser)
─────────────                   ─────────────────                 ──────────────
     │                                │                                │
     │── POST create-link ───────────▶│ Create ephemeral_invites       │
     │◀── { token, session_id } ──────│                                │
     │                                │                                │
     │   Share link /e/{token}        │                                │
     │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ▶│
     │                                │                                │
     │                                │◀── POST consume { token } ─────│
     │                                │ Validate → Create ephemeral_sessions│
     │                                │── { session, ownerBundle } ────▶│
     │                                │                                │
     │                                │    ┌── WebSocket bidirectional ──┐│
     │                                │    │                        │   │
     │◀══════ ephemeral-key-exchange ══╪════╪════════════════════════╪═══│ Guest X3DH
     │ X3DH respond                   │    │                        │   │
     │══════ ephemeral-key-exchange-ack╪════╪════════════════════════╪══▶│
     │                                │    │                        │   │
     │◀═══ ephemeral-message (E2EE) ══╪════╪════════════════════════╪══▶│ DR encrypted messages
     │◀═══ ephemeral-call-* (signaling)╪════╪════════════════════════╪══▶│ Call signaling
     │                                │    │                        │   │
     │                                │    └────────────────────────┘   │
     │                                │                                │
     │                                │── session expired ────────────▶│ Countdown ended
     │                                │   Clear sessions + invites     │ Destroy screen
```

### Link Lifecycle

#### 1. Owner Creates Link

The Owner clicks "Ephemeral Chat" in the app. The frontend generates an X3DH Prekey Bundle (`ik_pub`, `spk_pub`, `spk_sig`, `opks`) and sends it along with account authentication to the backend:

```
POST /api/v1/ephemeral/create-link
{ account_token, account_digest, prekey_bundle }
→ { token, session_id, expires_at }
```

- Link format: `https://domain/e/{token}`
- Each Owner may have at most **2** active sessions simultaneously
- Invite link validity defaults to **24 hours** (auto-expires if unconsumed)
- Owner can revoke the link before consumption (`POST /api/v1/ephemeral/revoke-invite`)

#### 2. Guest Consumes Link

The Guest opens the link; `boot()` parses the token from the URL (supports `/e/{token}`, `#{token}`, `?t={token}` formats):

```
POST /api/v1/ephemeral/consume
{ token }
→ { session_id, conversation_id, guest_digest, guest_device_id, ws_token, expires_at, prekey_bundle, owner_digest }
```

- Token can only be consumed once (`consumed_at` marking)
- Consumption creates an `ephemeral_sessions` record
- Guest receives a temporary identity (`guest_digest` + `guest_device_id`)
- Returns the Owner's Prekey Bundle for X3DH key exchange

#### 3. Link Expiry and Cleanup

- Unconsumed invites: expire after 24 hours (D1 `expires_at` field)
- Established sessions: default **10-minute** countdown, extendable
- Owner manual termination: `POST /api/v1/ephemeral/delete`
- Guest voluntary exit: sends `ephemeral-guest-leave` via WebSocket

### End-to-End Encryption (E2EE)

Ephemeral Chat uses the same Signal Protocol encryption flow as the main chat (X3DH + Double Ratchet); message content is encrypted client-side before being relayed through the server.

#### X3DH Key Exchange

```
Owner (when creating link)                          Guest (when consuming link)
──────────────────────                              ────────────────────────
Generate Prekey Bundle:                             Receive Owner Bundle:
  ik_pub (Identity Key)                               ik_pub, spk_pub, spk_sig, opks[0]
  spk_pub (Signed Prekey)
  spk_sig (Ed25519 Signature)                       Generate Guest Bundle:
  opks[] (One-Time Prekeys)                           ik_pub, spk_pub, spk_sig, ek_pub

                                                    x3dhInitiate(guestPriv, ownerBundle)
                                                    → ephDrState (Double Ratchet initial state)

                                                    Send ephemeral-key-exchange via WS
                         ◀─────────────────────── { guestBundle, opk_id }

x3dhRespond(ownerPriv, guestBundle)
→ ephDrState (matching DR state)

Send ephemeral-key-exchange-ack ──────────────▶ keyExchangeComplete = true
```

- Key exchange has **progressive retry** mechanism (2s → 4s → 8s → 15s → 30s)
- Starting from the 3rd retry, **HTTP Fallback** (`POST /api/v1/ephemeral/key-exchange-submit`) is activated concurrently, persisting the Guest Bundle to D1 to ensure the exchange can complete even if the Owner is offline/reconnecting
- Before receiving ACK, all message sending is blocked with a "waiting for encryption setup" prompt

#### Double Ratchet Message Encryption

After key exchange is complete, all messages (text, images, control messages) are encrypted via Double Ratchet:

```
Plaintext → drEncryptText(ephDrState, plaintext, { deviceId, version })
          → { header: { counter, deviceId, version }, iv_b64, ciphertext_b64 }

Ciphertext → drDecryptText(ephDrState, { header, iv_b64, ciphertext_b64 })
           → Plaintext
```

- Independent key per message (forward secrecy)
- Header contains counter (anti-replay), deviceId, version
- Encryption algorithm: XChaCha20-Poly1305 / AES-256-GCM (AEAD)

### WebSocket Real-Time Communication

#### Connection Establishment

The Guest establishes a WebSocket connection upon entering the chat:

```
WSS://{host}/api/ws?token={ws_token}&deviceId={guest_device_id}
→ Send { type: 'auth', accountDigest, token }
→ Receive { type: 'auth', ok: true }
```

#### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `ephemeral-message` | Bidirectional | E2EE encrypted message (text, image, control) |
| `ephemeral-key-exchange` | Guest→Owner | Guest's X3DH public keys |
| `ephemeral-key-exchange-ack` | Owner→Guest | Owner confirms key exchange complete |
| `ephemeral-extended` | Server→Both | Session extension notification (new `expires_at`) |
| `ephemeral-deleted` | Server→Guest | Owner terminated session |
| `ephemeral-guest-leave` | Guest→Owner | Guest voluntarily ends conversation |
| `ephemeral-peer-reconnected` | Server→Peer | Peer reconnected |
| `ephemeral-peer-disconnected` | Server→Peer | Peer disconnected |
| `ephemeral-call-*` | Bidirectional | Call signaling (invite/offer/answer/accept/reject/ice-candidate/end) |

#### Reconnection

- Exponential backoff reconnection: base 2s, cap 30s, with 30% random jitter
- WS Token refresh before reconnection (`POST /api/v1/ephemeral/ws-token`)
- Token refresh failure (session expired/deleted) → display destroy screen directly
- Successful reconnection automatically re-triggers incomplete key exchange
- On reconnection, server sends `ephemeral-peer-reconnected` to notify the peer

#### Offline Message Buffering

When the peer has no active WebSocket connection (e.g., page in background, disconnected), the server temporarily buffers messages:

- **Buffer limit**: Up to **50 messages** per conversation
- **Buffer TTL**: **5-minute** expiry with auto-cleanup
- **Bufferable types**: `ephemeral-message`, `ephemeral-key-exchange`, `ephemeral-key-exchange-ack`
- Buffered messages are automatically flushed in order when the peer reconnects (`_flushEphemeralBuffers()`)
- Expired buffers are cleaned up by Durable Object alarms

#### Control Messages

Special control messages sent through the E2EE encrypted channel (JSON `_ctrl` field):

| Control Type | Description |
|--------------|-------------|
| `set-nickname` | Guest sets nickname, notifies Owner |
| `peer-away` | Page went to background (`visibilitychange`) |
| `peer-back` | Page returned to foreground |
| `no-webrtc` | Notifies Owner that this Guest's browser does not support WebRTC |

### Timer and Session Management

#### Countdown Timer

- Session sets `expires_at` (Unix timestamp) upon creation
- Frontend updates every second (`setInterval`), displayed in `MM:SS` format
- Progress bar uses four-color gradient (green → yellow → red) with flame emoji indicator
- Remaining ≤20% time: clock text turns red + breathing animation
- Countdown reaches zero: automatically triggers `destroyChat()`

#### Session Extension

- "Extend" button enabled when ≤5 minutes remaining
- Each extension adds **10 minutes**
- Extension count tracked by `extended_count`
- Both Owner and Guest can trigger extension
- After extension, server notifies both parties via `ephemeral-extended` to sync the new `expires_at`

#### Session Termination

Three termination methods:

1. **Countdown ends** — Frontend detects `remaining ≤ 0`, auto-destroys
2. **Owner terminates** — `POST /api/v1/ephemeral/delete`, server sends `ephemeral-deleted` to notify Guest
3. **Guest terminates** — Click "End" button → confirmation modal → send `ephemeral-guest-leave` → destroy screen

Destroy flow (`destroyChat()`):
1. Stop Double Ratchet key exchange retries
2. Deactivate Ephemeral Call mode
3. Clear timers
4. Notify peer (if WS still connected)
5. Close WebSocket
6. Hide chat UI, display destroy screen
7. Clear all state (`sessionState`, `ephDrState`, `sessionStorage`)

### Voice / Video Calls

Ephemeral Chat integrates the standard call system via the **Ephemeral Call Adapter** bridge:

```
Guest UI                    Ephemeral Call Adapter              Standard Call Pipeline
─────────                   ──────────────────────              ─────────────────
voiceCallBtn.click()  ───▶  initiateEphemeralCall()
                            ↓
                            activateEphemeralCallMode({         initCallOverlay()
                              conversationId,                   initCallMediaSession()
                              sessionId,
                              peerDigest,
                              wsSend: (msg) => ws.send(msg),
                              side: 'guest'
                            })
                            ↓
                            ephemeral-call-* ◀══ translate ══▶ call-*
                            (WebSocket messages)              (Standard signaling)
```

- **WebRTC Detection**: Performed immediately on page load (before `boot()`), checks `RTCPeerConnection` + `getUserMedia`
- Unsupported: Splash screen shows warning → nickname screen shows warning → call buttons disabled in chat + system message notification → encrypted control message notifies Owner
- **Media Pre-request**: On entering chat, silently plays click sound to unlock Web Audio API and pre-requests mic + camera permissions (cached for 60 seconds)
- Call signaling is relayed via WebSocket `ephemeral-call-*` message types

### Guest UX Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Splash Screen │     │ Nickname Screen  │     │   Chat Screen   │     │  Destroy Screen │
│                 │     │                 │     │                 │     │                 │
│ ① WebRTC detect│     │ Flame avatar    │     │ Header (badge)  │     │ 🔥              │
│ ② Matrix anim  │────▶│ Nickname input   │────▶│ Countdown timer │────▶│ Chat destroyed  │
│ ③ Progress 0→100│    │  (≤20 chars)    │     │ Message list    │     │ All messages    │
│ ④ Verify→Encrypt│    │ WebRTC warning  │     │ Call buttons    │     │ permanently     │
│  →Connect       │     │ "Join" button   │     │ Attach + input │     │ cleared         │
│ ⑤ X3DH key     │     │                 │     │ End button      │     │                 │
│   exchange      │     │                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

#### Splash Screen (Progress Stages)

| Progress | Status Text | Actual Operation |
|----------|-------------|------------------|
| 0% | Page loaded | WebRTC detection (before `boot()`) |
| 20% | Verifying link validity... | Parse URL token |
| 40% | Generating ephemeral identity keys... | Load NaCl crypto library |
| 60% | Exchanging encryption protocol... | Consume token + X3DH key exchange |
| 80% | Establishing E2E encrypted channel... | Awaiting confirmation |
| 100% | Connection complete | Transition to nickname screen |

#### Error Handling

| HTTP Status | Displayed Message |
|-------------|-------------------|
| 404 | This link has expired or has already been used |
| 410 | This link has expired |
| Other | Connection failed: {error} |

### Database Schema

#### ephemeral_invites (One-Time Link Tokens)

| Column | Type | Description |
|--------|------|-------------|
| `token` | TEXT PK | One-time invite token |
| `owner_digest` | TEXT | Owner account digest (FK → accounts) |
| `owner_device_id` | TEXT | Owner device ID |
| `prekey_bundle_json` | TEXT | Owner X3DH Prekey Bundle (JSON) |
| `consumed_at` | INTEGER | Consumption timestamp (NULL = unconsumed) |
| `expires_at` | INTEGER | Expiry timestamp |
| `created_at` | INTEGER | Creation time |

#### ephemeral_sessions (Active Ephemeral Conversations)

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | TEXT PK | Session unique ID |
| `invite_token` | TEXT | Corresponding invite token |
| `owner_digest` | TEXT | Owner account digest |
| `owner_device_id` | TEXT | Owner device ID |
| `guest_digest` | TEXT | Guest temporary digest |
| `guest_device_id` | TEXT | Guest temporary device ID |
| `conversation_id` | TEXT | Conversation ID (FK → conversations) |
| `expires_at` | INTEGER | Expiry timestamp (extendable) |
| `extended_count` | INTEGER | Extension count |
| `created_at` | INTEGER | Creation time |
| `deleted_at` | INTEGER | Soft delete time (NULL = active) |
| `pending_key_exchange_json` | TEXT | HTTP Fallback buffered Guest public key bundle |

Indexes: `owner+deleted_at`, `guest_digest`, `conversation_id`, `expires_at`

### API Endpoints (`/api/v1/ephemeral/`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `create-link` | Owner | Create one-time link (with Prekey Bundle) |
| POST | `consume` | None | Guest consumes token, gets session info |
| POST | `extend` | Owner/Guest | Extend session by 10 minutes |
| POST | `delete` | Owner | Terminate session |
| POST | `revoke-invite` | Owner | Revoke unconsumed invite link |
| POST | `list` | Owner | List all active sessions |
| POST | `session-info` | Guest | Get session info (for reconnection) |
| POST | `ws-token` | Guest | Get new WebSocket token (for reconnection) |
| POST | `key-exchange-submit` | Guest | HTTP Fallback key exchange (persisted to D1) |
| POST | `clear-pending-kex` | Owner | Clear processed pending key exchanges |
| POST | `cleanup` | System | Garbage collection: clear expired sessions + unconsumed invites |

#### Server-Side Routing and Durable Objects

- **Message Routing**: `_handleEphemeralRelay()` queries the `ephemeral_sessions` table by `conversationId` / `sessionId` to determine the target peer digest and forwards via the corresponding Durable Object
- **Owner Notification**: `notifyAccountDO()` — routes to the registered account's AccountWebSocket DO
- **Guest Notification**: `notifyEphemeralDO()` — routes to the temporary Guest DO identified by the `EPHEMERAL_` prefix
- **WS Token**: HS256 JWT (`{ accountDigest, iat, exp }`), Guest token validity = remaining session time

#### Social Sharing Preview (OG Meta Tags)

Ephemeral links support social platform sharing previews (`/e/{token}` route by Cloudflare Functions):

- Crawlers (social platform bots): Return minimal HTML with OG meta tags (no redirect)
- Real browsers: Return HTML with OG tags + JavaScript instant redirect to `/pages/ephemeral.html#{token}`
- Localized OG text based on `Accept-Language` / `?lang=` parameter

### Security Design

- **One-time token** — 32-character nano ID, using `UPDATE ... WHERE consumed_at IS NULL` atomic operation to ensure single consumption
- **Temporary identity** — Guest receives a server-generated temporary identity (`EPHEMERAL_` + 32-char random digest, `eph-` + 16-char random device_id), not associated with any permanent account
- **Full E2EE** — All messages (including control messages, images) are encrypted via Double Ratchet; the server only relays ciphertext
- **Session limits** — Each Owner may have at most 2 simultaneously active sessions
- **Key exchange fallback** — WS retry + HTTP persistence dual path ensures key exchange never permanently fails due to network issues
- **Forward secrecy** — Each message uses an independent DR key; compromise does not affect other messages
- **State destruction** — All client state is cleared when session ends (`sessionState`, `ephDrState`, `sessionStorage`)
- **Peer Presence** — Detects whether the peer is in foreground via `visibilitychange` events, warns that messages may not be delivered

### Internationalization (i18n)

Ephemeral Chat fully supports **7 languages**: English, 繁體中文, 簡體中文, 日本語, 한국어, ภาษาไทย, Tiếng Việt

- Splash page uses **synchronous XHR** to load language packs (ensures correct language on first paint)
- Full i18n module loaded asynchronously after `boot()`
- All UI text marked via `data-i18n`, `data-i18n-placeholder`, `data-i18n-html` attributes
- Approximately **70+** ephemeral-specific i18n keys (covering splash, nickname, chat, calls, errors, timer, termination, etc.)

### File Structure

```
web/src/
├── pages/ephemeral.html                              # Guest-side complete HTML (Splash + Nickname + Chat + Destroy)
├── app/ui/ephemeral-ui.js                            # Guest-side controller (Boot, WS, E2EE, Timer, Call)
├── app/ui/mobile/controllers/ephemeral-controller.js # Owner-side controller (Create link, Manage sessions)
├── app/api/ephemeral.js                              # API wrapper (10 endpoints)
├── app/features/calls/ephemeral-call-adapter.js      # Call signaling translator (ephemeral-call-* ↔ call-*)
├── shared/crypto/dr.js                               # Double Ratchet encryption/decryption
├── shared/crypto/prekeys.js                          # X3DH Prekey Bundle generation
└── locales/{en,zh-Hant,zh-Hans,ja,ko,th,vi}.json    # i18n language packs

data-worker/
└── migrations/0010_add_ephemeral_sessions.sql         # DB Schema (invites + sessions)
```

---

## Chunked Encryption Streaming

### Upload Flow

```
User selects file
  ↓
Format detection (canRemuxVideo)
  ↓                                    ┌─────────────────────────────┐
  ├── Video file ──▶ WebCodecs transcode? │  WebCodecs auto-transcode 720p │
  │                  │                  │  All videos → 720p/1.5Mbps    │
  │                  ├── Needs transcode──│  4K/1080p auto-downscale to 720p│
  │                  ├── Already H.264 ──│  Exceeds limit→transcode,    │
  │                  │                  │  within limit→direct remux   │
  │                  └── Already fMP4 ──│  → Streaming Upload (low mem)│
  │                                     └─────────────────────────────┘
  │                  ↓
  │           MP4 Remux → fMP4 segments
  │                  ↓
  │           Each segment = one chunk
  │
  ├── Non-video file ──▶ Fixed 5MB byte-range chunks
  ↓
Per-chunk encryption: HKDF-SHA256(MK, random_salt, 'media/chunk-v1') → AES-256-GCM
  │  ├── Bulk Encryptor: CryptoKey imported once, shared across all chunks (saves per-chunk importKey)
  │  └── Plaintext buffer released immediately after encryption → reduces peak memory
  ↓
AIMD adaptive parallel upload → S3 Presigned URL (ArrayBuffer direct upload, no Blob copy)
  │  ├── Initial concurrency: navigator.connection auto-detect (4g→6, 3g→3, 2g→2)
  │  ├── Additive Increase: Stable RTT → +1 (cap 15)
  │  └── Multiplicative Decrease: timeout/error/RTT spike → ×0.5 (floor 2)
  ↓
Upload Manifest (v3): chunk list + codec info + track info + video duration
  ↓
Manifest encryption: HKDF-SHA256(MK, salt, 'media/manifest-v1') → AES-256-GCM
```

### Download & Streaming Playback

```
Message contains: { baseKey, manifestEnvelope }
  ↓
Download & decrypt Manifest (media/manifest-v1)
  ↓
Batch URL signing (20 URLs per batch, prefetch next batch)
  ↓
AIMD adaptive parallel download (30s timeout per chunk, 3 retries + exponential backoff)
  │  ├── Initial concurrency: navigator.connection auto-detect (4g→6, 3g→3, 2g→2)
  │  ├── Additive Increase: Stable RTT → +1 (cap 10)
  │  └── Multiplicative Decrease: timeout/error → ×0.5 (floor 2)
  ↓
Per-chunk decryption: AES-256-GCM
  ↓                                    ┌─────────────────────────────┐
MSE streaming playback                 │  MediaSource Extensions      │
  ├── Desktop: MediaSource API         │  Codec auto-detection from fMP4│
  ├── iOS 17.1+: ManagedMediaSource    │  H.264 / HEVC profiles      │
  │     (startstreaming/endstreaming)  │  Duration pre-set (prevent auto-pause)│
  └── Fallback: Blob URL full-file playback│  Buffer auto-eviction (5s behind)│
                                        │  QuotaExceeded auto evict    │
                                        └─────────────────────────────┘
```

### Manifest Structure (v3)

```json
{
  "v": 3,
  "segment_aligned": true,
  "totalSize": 52428800,
  "totalChunks": 12,
  "contentType": "video/mp4",
  "name": "video.mp4",
  "duration": 127.5,
  "chunks": [
    { "index": 0, "size": 4194304, "cipher_size": 4194320, "iv_b64": "...", "salt_b64": "..." }
  ],
  "tracks": [
    { "type": "muxed", "codec": "avc1.64001E" }
  ]
}
```

### Streaming Performance Metrics

| Metric | Value |
|--------|-------|
| Max file size | 1 GB |
| Max chunk count | 2,000 |
| Fixed chunk size (non-video) | 5 MB |
| Upload concurrency | AIMD adaptive 2–15 (auto-adjusted by network speed) |
| Download concurrency | AIMD adaptive 2–10 (auto-adjusted by network speed) |
| Initial concurrency detection | `navigator.connection.effectiveType` (4g→6, 3g→3, 2g→2) |
| AIMD adjustment strategy | Stable RTT → +1; timeout/error/RTT 1.5x → ×0.5 |
| URL prefetch batch | 20 URLs/batch |
| Upload timeout/chunk | 120 seconds |
| Download timeout/chunk | 30 seconds |
| Upload retries | 2 retries, exponential backoff (2s→4s) |
| Download retries | 3 retries, exponential backoff (1s→8s) |
| Encryption acceleration | Bulk Encryptor (CryptoKey single import, shared across all chunks) |
| Upload transfer | ArrayBuffer direct upload (no Blob copy) |
| Duration pre-set | Manifest includes video duration, set MediaSource.duration before playback |
| MSE max in-flight appends | 15 |
| Buffer eviction retention | currentTime - 5s |

---

## Office Document Viewer

A pure frontend Office document parsing and rendering engine with **zero server dependency and zero third-party rendering services**. Parses binary/XML formats directly in the browser and converts to HTML, supporting Word (.doc/.docx), Excel (.xlsx/.xls), and PowerPoint (.pptx).

### Architecture

```
Encrypted file (R2)
    │
    ▼
Client-side decryption (AES-256-GCM)
    │
    ├── .docx/.xlsx/.pptx ──▶ JSZip decompress ──▶ OOXML XML parse ──▶ HTML render
    │
    └── .doc ──▶ OLE2 Compound Binary parse ──▶ Piece Table + Sprm ──▶ HTML render
```

All parsing is performed in client-side memory; document plaintext never leaves the browser, adhering to end-to-end encryption principles.

### Word Viewer (.doc / .docx)

A self-implemented complete Word document parser with no dependency on any Word rendering library. Supports the full specification of both formats:

#### .docx — OOXML (ECMA-376) Specification Support

**Table Properties (§17.4)**

| Spec Section | Element | Feature | Status |
|--------------|---------|---------|--------|
| §17.4.63 | `tblW` | Table width (dxa/pct/auto) | ✅ |
| §17.4.29 | `jc` | Table horizontal alignment (center/right/end) | ✅ |
| §17.4.51 | `tblInd` | Table left indent | ✅ |
| §17.4.53 | `tblLayout` | Fixed/auto layout | ✅ |
| §17.4.46 | `tblCellSpacing` | Cell spacing | ✅ |
| §17.4.40 | `tblBorders` | Table borders (6-edge granularity parsing + insideH/V fallback) | ✅ |
| §17.4.42 | `tblCellMar` | Table default cell margins | ✅ |
| — | `tblGrid` | Column width definitions (colgroup) | ✅ |
| §17.4.82 | `trHeight` | Row height (exact/atLeast) | ✅ |
| §17.4.17 | `gridSpan` | Horizontal merge (colspan) | ✅ |
| §17.4.85 | `vMerge` | Vertical merge (rowspan, including gridSpan index calculation) | ✅ |
| §17.4.22 | `hMerge` | Legacy horizontal merge | ✅ |
| §17.4.66 | `tcBorders` | Cell borders (per-cell override) | ✅ |
| §17.4.33 | `shd` | Cell shading | ✅ |
| §17.4.84 | `vAlign` | Vertical alignment | ✅ |
| §17.4.68 | `tcW` | Cell width (dxa/pct) | ✅ |
| §17.4.43 | `tcMar` | Individual cell margins | ✅ |
| §17.4.87 | `textDirection` | Cell text direction (btLr/tbRl) | ✅ |
| §17.4.30 | `noWrap` | Cell no-wrap | ✅ |
| — | Nested tables | Recursive renderTable | ✅ |

**Character Formatting (§17.3.2 rPr)**

| Spec Section | Element | Feature | Status |
|--------------|---------|---------|--------|
| §17.3.2.1 | `b` / `bCs` | Bold (including val=false explicit off) | ✅ |
| §17.3.2.16 | `i` / `iCs` | Italic (including val=false explicit off) | ✅ |
| §17.3.2.40 | `u` | Underline (styles: double/dotted/dashed/wavy + color) | ✅ |
| §17.3.2.37 | `strike` | Strikethrough | ✅ |
| §17.3.2.9 | `dstrike` | Double strikethrough | ✅ |
| §17.3.2.38 | `sz` / `szCs` | Font size | ✅ |
| §17.3.2.6 | `color` | Text color | ✅ |
| §17.3.2.26 | `rFonts` | Font (ascii/hAnsi/eastAsia/cs) | ✅ |
| §17.3.2.15 | `highlight` | Highlight | ✅ |
| §17.3.2.30 | `shd` | Character background | ✅ |
| §17.3.2.42 | `vertAlign` | Superscript/subscript | ✅ |
| §17.3.2.32 | `smallCaps` | Small caps | ✅ |
| §17.3.2.5 | `caps` | All caps | ✅ |
| §17.3.2.41 | `vanish` | Hidden text | ✅ |
| §17.3.2.25 | `outline` | Text outline | ✅ |
| §17.3.2.31 | `shadow` | Shadow effect | ✅ |
| §17.3.2.10 | `emboss` | Emboss effect | ✅ |
| §17.3.2.18 | `imprint` | Engrave effect | ✅ |
| §17.3.2.35 | `spacing` | Character spacing (letter-spacing) | ✅ |
| §17.3.2.44 | `w` | Character width scaling | ✅ |
| §17.3.2.27 | `position` | Text raise/lower | ✅ |
| §17.3.2.4 | `bdr` | Character border | ✅ |
| §17.3.2.11 | `em` | East Asian emphasis marks | ✅ |

**Paragraph Formatting (§17.3.1 pPr)**

| Element | Feature | Status |
|---------|---------|--------|
| `jc` | Alignment (left/center/right/justify) | ✅ |
| `spacing` | Before/after spacing, line spacing | ✅ |
| `ind` | Indentation (left/right/firstLine/hanging) | ✅ |
| `pBdr` | Paragraph borders | ✅ |
| `shd` | Paragraph background | ✅ |
| `pageBreakBefore` | Page break | ✅ |
| `outlineLvl` | Heading level | ✅ |
| `numPr` | List numbering/bullets | ✅ |
| `pStyle` + `basedOn` | Style inheritance chain | ✅ |
| `docDefaults` | Document default styles | ✅ |

**Other Features**

| Feature | Status |
|---------|--------|
| Inline images (`<w:drawing>`) | ✅ |
| Legacy images (`<w:pict>`) | ✅ |
| Hyperlinks (`<w:hyperlink>`) | ✅ |
| OMML math formulas | ✅ |
| Page break / line break / tab | ✅ |
| Bookmarks / proofreading marks | ✅ (skipped) |

#### .doc — MS-DOC Binary ([MS-DOC]) Specification Support

**Binary Parsing Pipeline**

```
OLE2 Compound File → FAT/Mini-FAT → WordDocument Stream + Table Stream
    → FIB (File Information Block)
    → Piece Table (FC ↔ CP mapping)
    → PlcBteChpx (Character formatting)
    → PlcBtePapx (Paragraph formatting)
    → SttbfFfn (Font table)
    → LSTF/LFO (List definitions)
    → OfficeArt (Images)
    → OLE Embedding (Charts)
```

**Table Properties (TAP Sprms)**

| Sprm Code | Name | Feature | Status |
|-----------|------|---------|--------|
| 0xD608 | sprmTDefTable | Cell boundaries + TC structure (merge flags + BRC80 borders + fVertical) | ✅ |
| 0xD612 | sprmTDefTableShd | Cell shading (SHD) | ✅ |
| 0xD613 | sprmTDefTableShd2nd | Alternate shading format | ✅ |
| 0xD670 | sprmTCellShd | New cell shading | ✅ |
| 0x5400 | sprmTJc | Table alignment (Word 97) | ✅ |
| 0x5407 | sprmTJc90 | Table alignment (Word 2000+) | ✅ |
| 0x9407 | sprmTDyaRowHeight | Row height (exact/at-least) | ✅ |
| 0x9601 | sprmTDxaLeft | Table left indent | ✅ |
| 0x9602 | sprmTDxaGapHalf | Cell spacing | ✅ |
| 0xD62F | sprmTCellPadding | Cell padding | ✅ |
| 0xD634 | sprmTBrcTopCv | Top border RGB color vector | ✅ |
| 0xD635 | sprmTBrcLeftCv | Left border RGB color vector | ✅ |
| 0xD636 | sprmTBrcBottomCv | Bottom border RGB color vector | ✅ |
| 0xD637 | sprmTBrcRightCv | Right border RGB color vector | ✅ |
| 0xD605 | sprmTTableBorders | Table borders (BRC format, 6-edge granularity) | ✅ |
| 0xD620 | sprmTTableBorders80 | Table borders (BRC80 format) | ✅ |

**TC Structure ([MS-DOC] §2.9.327)**

| Field | Feature | Status |
|-------|---------|--------|
| fFirstMerged / fMerged | Horizontal merge (colspan) | ✅ |
| fVertMerge / fVertRestart | Vertical merge (rowspan) | ✅ |
| fVertical / fBackward | Text direction | ✅ |
| fRotateFont | Font rotation | ✅ |
| wWidth | Preferred cell width | ✅ |
| BRC80 × 4 | Four-side borders (ico → RGB + brcType → CSS) | ✅ |

**Character Formatting (CHP Sprms)**

| Sprm Code | Name | Feature | Status |
|-----------|------|---------|--------|
| 0x0835 | sprmCFBold | Bold | ✅ |
| 0x0836 | sprmCFItalic | Italic | ✅ |
| 0x0837 | sprmCFStrike | Strikethrough | ✅ |
| 0x0875 | sprmCFDStrike | Double strikethrough | ✅ |
| 0x0838 | sprmCFOutline | Text outline | ✅ |
| 0x083C | sprmCFShadow | Shadow | ✅ |
| 0x0858 | sprmCFEmboss | Emboss | ✅ |
| 0x0854 | sprmCFImprint | Engrave | ✅ |
| 0x083A | sprmCFSmallCaps | Small caps | ✅ |
| 0x083B | sprmCFCaps | All caps | ✅ |
| 0x0839 | sprmCFVanish | Hidden text | ✅ |
| 0x2A3E | sprmCKul | Underline type (single/double/dotted/dashed/wavy) | ✅ |
| 0x4A43 | sprmCHps | Font size | ✅ |
| 0x6870 | sprmCCv | Text color (COLORREF) | ✅ |
| 0x6877 | sprmCCvUl | Underline color | ✅ |
| 0x4A4F/50/51 | sprmCRgFtc0/1/2 | Font index (ASCII > Other > EastAsia priority) | ✅ |
| 0x4845 | sprmCIco | Legacy color index (Word 97) | ✅ |
| 0x2A0C | sprmCHighlight | Highlight | ✅ |
| 0x484B | sprmCHpsPos | Superscript/subscript offset (signed half-points) | ✅ |
| 0x2A42 | sprmCIss | Superscript/subscript (iss format) | ✅ |
| 0x8840 | sprmCDxaSpace | Character spacing | ✅ |
| 0x4A61 | sprmCHpsKern | Kerning | ✅ |
| 0x6878 | sprmCBrc80 | Character border | ✅ |

**Paragraph Formatting (PAP Sprms)**

| Sprm Code | Feature | Status |
|-----------|---------|--------|
| sprmPJc80 / sprmPJc | Alignment | ✅ |
| sprmPDyaBefore / After | Before/after spacing | ✅ |
| sprmPDxaLeft / Right / Left1 | Indentation | ✅ |
| sprmPDyaLine | Line spacing (proportional/exact/at-least) | ✅ |
| sprmPOutLvl | Heading level | ✅ |
| sprmPIlvl / sprmPIlfo | List level/format | ✅ |
| sprmPShd80 | Paragraph background | ✅ |
| sprmPBrcTop80 / Left / Bottom / Right | Paragraph borders | ✅ |
| sprmPFPageBreakBefore | Page break | ✅ |
| sprmPFInTable / sprmPFTtp | Table membership flags | ✅ |
| Style inheritance (istd + STSH) | Paragraph/character style chain resolution | ✅ |
| LSTF / LFO | List definitions + overrides | ✅ |

**Other Features**

| Feature | Status |
|---------|--------|
| OLE2 Compound File parsing | ✅ |
| FIB (File Information Block) | ✅ |
| Piece Table (FC ↔ CP) | ✅ |
| SttbfFfn font table parsing | ✅ |
| OfficeArt image extraction | ✅ |
| OLE embedded charts | ✅ |
| HYPERLINK field parsing | ✅ |
| Math formulas (OMML) | ✅ |
| Fallback text extraction | ✅ |

### OOXML Border Style Mapping

Word's 24 border types mapped to CSS:

| Word Border | CSS Style |
|-------------|-----------|
| single, thick, thinThick*, thickThin* | solid |
| double, triple | double |
| dotted | dotted |
| dashed, dashSmallGap, dotDash, dotDotDash, dashDotStroked | dashed |
| wave | solid |
| doubleWave | double |
| threeDEmboss | ridge |
| threeDEngrave | groove |
| outset | outset |
| inset | inset |

### Specification Coverage

| Area | Coverage | Notes |
|------|----------|-------|
| DOCX Tables (ECMA-376 §17.4) | ~95% | Only missing complete `tblStyle` table style definition parsing |
| MS-DOC Tables ([MS-DOC] TAP) | ~98% | Only missing extremely rare sprms like sprmTSetBrc |
| DOCX Character Formatting (§17.3.2) | ~95% | Only missing `kern`/`effect`(legacy)/`fitText` |
| MS-DOC Character Formatting (CHP) | ~97% | Only missing complex script sprms like sprmCFBiDi |
| DOCX Paragraph Formatting (§17.3.1) | ~95% | Core properties complete |
| MS-DOC Paragraph Formatting (PAP) | ~95% | Core properties complete |

---

## Project Structure

```
SENTRY-Messenger/
│
├── data-worker/                      # ═══ Cloudflare Workers Unified Backend ═══
│   ├── src/
│   │   ├── worker.js                 # Main entry: REST API routing, HMAC auth,
│   │   │                             #   OPAQUE/SDM authentication, D1/R2/KV ops,
│   │   │                             #   key management, message CRUD, media signing,
│   │   │                             #   call management, contacts/groups/subscription API
│   │   ├── account-ws.js             # Durable Object: per-account WebSocket management
│   │   │                             #   JWT auth, heartbeat, call signaling relay,
│   │   │                             #   Presence (KV), message/event broadcast
│   │   └── u8-strict.js              # Uint8Array validation utility
│   ├── package.json                  # Worker dependencies (@cloudflare/opaque-ts)
│   ├── migrations/                   # D1 database migrations
│   │   ├── 0001_consolidated.sql     # Main schema (core tables)
│   │   ├── 0002_fix_missing_tables.sql  # Add missing tables (contact_secret_backups, etc.)
│   │   ├── 0003_restore_deletion_cursors.sql  # deletion_cursors + legacy prekey
│   │   ├── 0004_add_conversation_deletion_log.sql  # Conversation deletion log table
│   │   ├── 0005_add_min_ts_to_deletion_cursors.sql # Add min_ts column
│   │   ├── 0006_drop_min_counter_from_deletion_cursors.sql # Remove min_counter
│   │   └── 0007_add_pairing_code.sql # Pairing code support
│   └── wrangler.toml                 # Workers config (D1 + KV + Durable Objects bindings)
│
├── web/                              # ═══ Frontend SPA ═══
│   ├── build.mjs                     # esbuild build config
│   ├── package.json                  # Frontend dependencies (esbuild)
│   ├── scripts/
│   │   └── verify-build.mjs         # Build integrity verification script
│   └── src/
│       ├── index.html                # Entry page (redirects to login)
│       │
│       ├── pages/                    # Pages
│       │   ├── login.html            # Login page
│       │   ├── app.html              # Main app page
│       │   ├── debug.html            # Debug panel
│       │   ├── logout.html           # Logout redirect
│       │   └── mic-test.html         # Microphone test
│       │
│       ├── functions/                # Cloudflare Pages Functions
│       │   ├── [[path]].ts           # Route handler
│       │   └── apple-app-site-association.ts  # iOS App association
│       │
│       ├── app/                      # Application core
│       │   ├── api/                  # API call wrappers
│       │   │   ├── account.js        #   Account API
│       │   │   ├── auth.js           #   Authentication API (SDM/OPAQUE/MK)
│       │   │   ├── calls.js          #   Calls API
│       │   │   ├── contact-secrets.js #  Contact secrets backup API
│       │   │   ├── devkeys.js        #   Device key API
│       │   │   ├── friends.js        #   Friends API
│       │   │   ├── groups.js         #   Groups API
│       │   │   ├── invites.js        #   Invite Dropbox API
│       │   │   ├── media.js          #   Media signing API
│       │   │   ├── message-key-vault.js # Message Key Vault API
│       │   │   ├── messages.js       #   Messages API
│       │   │   ├── prekeys.js        #   X3DH prekey retrieval
│       │   │   ├── subscription.js   #   Subscription API
│       │   │   └── ws.js             #   WebSocket connection management
│       │   │
│       │   ├── core/                 # Core infrastructure
│       │   │   ├── store.js          #   Central state store (account/device/contacts/messages)
│       │   │   ├── contact-secrets.js #  Contact secret persistence (encrypt/decrypt)
│       │   │   ├── http.js           #   HTTP client
│       │   │   └── log.js            #   Structured logging
│       │   │
│       │   ├── crypto/               # Cryptography implementations
│       │   │   ├── dr.js             #   Double Ratchet protocol
│       │   │   ├── aead.js           #   AEAD encryption (XChaCha20/AES-GCM)
│       │   │   ├── nacl.js           #   TweetNaCl wrapper (X25519/Ed25519)
│       │   │   ├── prekeys.js        #   X3DH prekey utilities
│       │   │   ├── kdf.js            #   Key derivation (HKDF/Argon2id)
│       │   │   └── invite-dropbox.js #   Offline invite encryption
│       │   │
│       │   ├── features/             # Feature modules
│       │   │   ├── dr-session.js     #   X3DH init + DR Session management (core)
│       │   │   ├── contact-share.js  #   Contact share encrypt/decrypt
│       │   │   ├── contact-backup.js #   Contact secret backup coordination
│       │   │   ├── contacts.js       #   Contact list management
│       │   │   ├── conversation.js   #   Conversation context handling
│       │   │   ├── conversation-updates.js # Conversation update notifications
│       │   │   ├── device-priv.js    #   Device private key management
│       │   │   ├── invite-reconciler.js #  Invite reconciliation/confirmation
│       │   │   ├── login-flow.js     #   Authentication flow orchestration
│       │   │   ├── opaque.js         #   OPAQUE authentication
│       │   │   ├── sdm.js            #   SDM authentication flow
│       │   │   ├── sdm-sim.js        #   SDM simulation (Sim Chips)
│       │   │   ├── profile.js        #   User profile
│       │   │   ├── settings.js       #   Application settings
│       │   │   ├── groups.js         #   Group management
│       │   │   ├── media.js          #   Media handling (upload/download)
│       │   │   ├── chunked-upload.js #   Chunked encrypted upload (auto 720p transcode + fMP4 + AES-GCM + AIMD adaptive concurrency)
│       │   │   ├── chunked-download.js #  Chunked decrypted download (AIMD adaptive concurrency + URL prefetch)
│       │   │   ├── adaptive-concurrency.js # AIMD adaptive concurrency controller (TCP congestion control heuristic)
│       │   │   ├── mse-player.js    #   MSE/ManagedMediaSource streaming player
│       │   │   ├── webcodecs-transcoder.js # WebCodecs auto 720p/1.5Mbps H.264 transcoder
│       │   │   ├── mp4-remuxer.js   #   MP4 → fMP4 remux (box parsing + segmentation + duration extraction)
│       │   │   ├── transfer-progress.js #  Transfer progress UI (dual progress bars + step checklist + real-time speed)
│       │   │   ├── semantic.js       #   Semantic versioning
│       │   │   ├── messages.js       #   Message processing
│       │   │   ├── messages-flow-facade.js # Message flow facade entry
│       │   │   ├── messages-notify-policy.js # Message notification policy
│       │   │   ├── messages-sync-policy.js  # Message sync policy
│       │   │   ├── timeline-store.js #   Timeline message store
│       │   │   ├── message-key-vault.js # Message Key Vault
│       │   │   ├── secure-conversation-manager.js # Conversation security manager
│       │   │   ├── secure-conversation-signals.js # Control messages
│       │   │   ├── restore-coordinator.js # Restore pipeline
│       │   │   ├── restore-policy.js #   Restore policy
│       │   │   │
│       │   │   ├── messages-flow/    #   Message flow pipeline
│       │   │   │   ├── index.js      #     Facade entry
│       │   │   │   ├── state.js      #     State machine
│       │   │   │   ├── crypto.js     #     Encrypt/decrypt operations
│       │   │   │   ├── flags.js      #     Feature flags
│       │   │   │   ├── policy.js     #     Send/sync policy
│       │   │   │   ├── queue.js      #     Message queue
│       │   │   │   ├── reconcile.js  #     Server/local sync
│       │   │   │   ├── reconcile/    #     Sync decision modules
│       │   │   │   │   └── decision.js #     Sync decision logic
│       │   │   │   ├── normalize.js  #     Message normalization
│       │   │   │   ├── presentation.js #   UI presentation logic
│       │   │   │   ├── vault-replay.js #   Vault replay decryption
│       │   │   │   ├── hybrid-flow.js #    Hybrid offline/online flow
│       │   │   │   ├── gap-queue.js  #     Gap detection queue
│       │   │   │   ├── local-counter.js #  Local counter management
│       │   │   │   ├── notify.js     #     Notification trigger
│       │   │   │   ├── probe.js      #     Message probe
│       │   │   │   ├── scroll-fetch.js #   Scroll-to-load
│       │   │   │   ├── server-api.js #     Server API integration
│       │   │   │   ├── live/         #     Live message sync
│       │   │   │   │   ├── index.js         # Live module entry
│       │   │   │   │   ├── coordinator.js   # Sync coordinator
│       │   │   │   │   ├── job.js           # Sync job
│       │   │   │   │   ├── state-live.js    # Live state management
│       │   │   │   │   ├── server-api-live.js # Live API integration
│       │   │   │   │   └── adapters/        # Adapter layer
│       │   │   │   │       └── index.js     #   Adapter entry
│       │   │   │   └── messages/     #     Message processing sub-pipeline
│       │   │   │       ├── index.js         # Sub-pipeline entry
│       │   │   │       ├── decrypt.js       # Message decryption
│       │   │   │       ├── counter.js       # Counter management
│       │   │   │       ├── gap.js           # Gap detection/backfill
│       │   │   │       ├── pipeline.js      # Processing pipeline
│       │   │   │       ├── pipeline-state.js # Pipeline state
│       │   │   │       ├── cache.js         # Message cache
│       │   │   │       ├── parser.js        # Message parser
│       │   │   │       ├── vault.js         # Vault operations
│       │   │   │       ├── receipts.js      # Receipt processing
│       │   │   │       ├── placeholder-store.js # Placeholder management
│       │   │   │       ├── entry-fetch.js   # Fetch entry
│       │   │   │       ├── entry-incoming.js # Incoming entry
│       │   │   │       ├── live-repair.js   # Live repair
│       │   │   │       ├── sync-server.js   # Server sync
│       │   │   │       ├── sync-offline.js  # Offline sync
│       │   │   │       └── ui/              # Message UI layer
│       │   │   │           ├── renderer.js       # Message renderer
│       │   │   │           ├── timeline-handler.js # Timeline handler
│       │   │   │           ├── interactions.js   # Interaction handlers
│       │   │   │           ├── media-preview.js  # Media preview
│       │   │   │           └── outbox-hooks.js   # Outbox hooks
│       │   │   │
│       │   │   ├── queue/            #   Message queues
│       │   │   │   ├── outbox.js     #     Send queue
│       │   │   │   ├── inbox.js      #     Receive processing
│       │   │   │   ├── receipts.js   #     Read receipts
│       │   │   │   ├── media.js      #     Media metadata
│       │   │   │   ├── send-policy.js #    Send retry policy
│       │   │   │   └── db.js         #     Local queue DB
│       │   │   │
│       │   │   ├── calls/            #   Call features (WebRTC + MediaPipe)
│       │   │   │   ├── index.js      #     Call module entry
│       │   │   │   ├── events.js     #     Call state events
│       │   │   │   ├── signaling.js  #     Call signaling
│       │   │   │   ├── key-manager.js #    Per-call E2EE keys (InsertableStreams)
│       │   │   │   ├── media-session.js #  WebRTC P2P media management
│       │   │   │   ├── face-blur.js  #     MediaPipe face/background blur pipeline
│       │   │   │   ├── identity.js   #     Participant identity
│       │   │   │   ├── network-config.js # Cloudflare STUN/TURN config
│       │   │   │   ├── state.js      #     Call state machine
│       │   │   │   └── call-log.js   #     Call log
│       │   │   │
│       │   │   ├── soft-deletion/    #   Message soft deletion
│       │   │   │   ├── deletion-api.js  #  Deletion API wrapper
│       │   │   │   └── deletion-store.js #  Deletion state store
│       │   │   │
│       │   │   └── messages-support/ #   Support stores
│       │   │       ├── conversation-clear-store.js
│       │   │       ├── conversation-tombstone-store.js
│       │   │       ├── processed-messages-store.js
│       │   │       ├── receipt-store.js
│       │   │       ├── vault-ack-store.js
│       │   │       └── ws-sender-adapter.js  # WebSocket send adapter
│       │   │
│       │   ├── ui/                   # UI layer
│       │   │   ├── app-ui.js         #   Main app UI
│       │   │   ├── app-mobile.js     #   Mobile entry
│       │   │   ├── login-ui.js       #   Login screen
│       │   │   ├── debug-page.js     #   Debug panel
│       │   │   ├── version-info.js   #   Version info display
│       │   │   ├── media-permission-demo.js # Media permission demo
│       │   │   │
│       │   │   └── mobile/           #   Mobile UI
│       │   │       ├── controllers/  #     MVC Controllers
│       │   │       │   ├── base-controller.js           # Base Controller
│       │   │       │   ├── active-conversation-controller.js
│       │   │       │   ├── conversation-list-controller.js
│       │   │       │   ├── message-sending-controller.js
│       │   │       │   ├── message-flow-controller.js
│       │   │       │   ├── message-status-controller.js
│       │   │       │   ├── share-controller.js
│       │   │       │   ├── call-log-controller.js
│       │   │       │   ├── group-builder-controller.js
│       │   │       │   ├── layout-controller.js
│       │   │       │   ├── media-handling-controller.js
│       │   │       │   ├── composer-controller.js
│       │   │       │   ├── secure-status-controller.js
│       │   │       │   └── toast-controller.js
│       │   │       │
│       │   │       ├── messages-pane.js     # Message timeline display
│       │   │       ├── contacts-view.js     # Contact list
│       │   │       ├── conversation-threads.js # Conversation thread list
│       │   │       ├── drive-pane.js        # File storage view
│       │   │       ├── profile-card.js      # Profile card
│       │   │       ├── session-store.js     # Session state
│       │   │       ├── contact-core-store.js # Contact data management
│       │   │       ├── ws-integration.js    # WebSocket integration
│       │   │       ├── presence-manager.js  # Online status management
│       │   │       ├── notification-audio.js # Notification sound
│       │   │       ├── call-audio.js        # Call audio
│       │   │       ├── call-overlay.js      # Call UI overlay
│       │   │       ├── connection-indicator.js # Connection status indicator
│       │   │       ├── browser-detection.js # Browser detection
│       │   │       ├── debug-flags.js       # Debug flags
│       │   │       ├── media-permission-manager.js # Media permission manager
│       │   │       ├── messages-ui-policy.js # Message UI policy
│       │   │       ├── modal-utils.js       # Modal utilities
│       │   │       ├── swipe-utils.js       # Swipe gesture utilities
│       │   │       ├── ui-utils.js          # General UI utilities
│       │   │       ├── zoom-disabler.js     # Zoom disabler
│       │   │       ├── viewers/             # File viewers
│       │   │       │   ├── image-viewer.js  #   Image viewer
│       │   │       │   ├── pdf-viewer.js    #   PDF viewer
│       │   │       │   ├── word-viewer.js   #   Word (.doc/.docx) viewer
│       │   │       │   ├── excel-viewer.js  #   Excel (.xlsx/.xls) viewer
│       │   │       │   └── pptx-viewer.js   #   PowerPoint (.pptx) viewer
│       │   │       └── modals/              # Modal dialogs
│       │   │           ├── password-modal.js
│       │   │           ├── settings-modal.js
│       │   │           └── subscription-modal.js
│       │   │
│       │   └── lib/                  # Frontend utility library
│       │       ├── identicon.js      #   Identity avatar generation
│       │       ├── invite.js         #   Invite link handling
│       │       ├── logging.js        #   Logging utility
│       │       ├── qr.js             #   QR Code generation/scanning
│       │       └── vendor/           #   Third-party libraries
│       │           ├── cropper.esm.js       # Image cropping
│       │           ├── qr-scanner.min.js    # QR scanner
│       │           ├── qr-scanner-worker.min.js # QR worker
│       │           └── qrcode-generator.js  # QR generator
│       │
│       ├── libs/                     # Third-party precompiled libraries
│       │   ├── nacl-fast.min.js     #   TweetNaCl minified
│       │   └── ntag424-sim.js       #   NFC tag simulation
│       │
│       ├── shared/                   # Shared code (frontend/backend)
│       │   ├── crypto/
│       │   │   ├── dr.js             #   Double Ratchet (shared implementation)
│       │   │   ├── aead.js           #   AEAD encryption
│       │   │   ├── nacl.js           #   NaCl utilities
│       │   │   ├── ed2curve.js       #   Ed25519 → X25519 curve conversion
│       │   │   └── prekeys.js        #   X3DH prekeys
│       │   ├── conversation/
│       │   │   └── context.js        #   Conversation context derivation
│       │   ├── contacts/
│       │   │   └── contact-share.js  #   Shared contact encryption
│       │   ├── calls/
│       │   │   ├── schemas.js        #   Call schema (JS)
│       │   │   ├── schemas.ts        #   Call schema (TS types)
│       │   │   └── network-config.json # STUN/TURN config
│       │   └── utils/
│       │       ├── base64.js         #   Base64 utilities
│       │       ├── cdn-integrity.js  #   CDN integrity verification
│       │       ├── sri.js            #   SRI (Subresource Integrity)
│       │       └── u8-strict.js      #   Uint8Array validation
│       │
│       └── assets/                   # Static assets
│           ├── *.css                 #   Modular stylesheets (app-base, app-layout, app-messages, etc.)
│           ├── favicon.ico           #   Site icon
│           ├── audio/                #   UI sounds (notify, click, call-in/out, accept, end-call)
│           └── images/               #   Image assets (avatar, logo, encryption.gif)
│
├── tests/                            # ═══ Tests ═══
│   ├── e2e/                          # Playwright E2E tests
│   │   ├── login-smoke.spec.mjs      #   Login smoke test
│   │   └── global-setup.mjs          #   Global setup
│   ├── unit/                         # Unit tests
│   │   ├── contact-secrets.spec.mjs
│   │   ├── encoding.spec.mjs
│   │   ├── logging.spec.mjs
│   │   ├── semantic.spec.mjs
│   │   ├── snapshot-normalization.spec.mjs
│   │   └── timeline-precision.spec.mjs
│   ├── dr-offline-sim.mjs            # Double Ratchet offline simulation
│   ├── fixtures/                     # Test data
│   │   ├── accounts.local.json       #   Local account config
│   │   └── accounts.sample.json      #   Sample account config
│   ├── scripts/                      # Test helper scripts
│   │   ├── capture-screens.mjs       #   Screen capture
│   │   ├── debug-dr-replay.mjs       #   DR replay debugging
│   │   └── proto-harness.mjs         #   Protocol test harness
│   └── assets/                       # Test assets
│
├── scripts/                          # ═══ Deployment & Tools ═══
│   ├── deploy-hybrid.sh              # One-click deploy
│   ├── deploy-prod.sh                # Production deployment
│   ├── wipe-all.sh                   # Full environment wipe
│   ├── serve-web.mjs                 # Local web server
│   ├── debug-history-fetch.js        # History message fetch debug
│   ├── inspect-server-backup.mjs     # Server backup inspector
│   ├── cleanup/                      # Cleanup tools
│   │   ├── d1-wipe-all.sql           #   D1 full table wipe SQL
│   │   └── wipe-all.sh               #   Cleanup script
│   └── lib/                          # Script shared library
│       ├── argon2-wrap.mjs           #   Argon2 wrapper
│       └── u8-strict.js              #   Uint8Array validation
│
├── tools/                            # ═══ Tools ═══
│   └── inspect-contact-secrets-snapshot.mjs  # Contact secrets snapshot inspector
│
├── docs/                             # ═══ Documentation ═══
│   ├── messages-flow-architecture.md # Message flow architecture
│   ├── messages-flow-spec.md         # Message flow authoritative spec
│   ├── messages-flow-invariants.md   # Invariants documentation
│   ├── messages-flow-refactor-audit.md # Message flow refactor audit
│   ├── message-flow-legacy-checks.md # Legacy checks checklist
│   ├── topup-system-spec.md          # Top-up system spec
│   └── internal/                     # Internal documentation
│
├── playwright.config.ts              # Playwright test config
└── package.json                      # Project config
```

---

## Cryptographic Protocols

### X3DH Key Exchange

```
    Alice (Initiator)                           Bob (Responder)
    ─────────────────                           ─────────────────
    Holds: IKa (Identity Key)                   Holds: IKb, SPKb (Signed Prekey), OPKb (One-Time Prekey)

    1. Fetch Bob's Prekey Bundle
       ← [IKb, SPKb, SPK_sig, OPKb]

    2. Verify SPKb signature (Ed25519)

    3. Generate Ephemeral Key: EKa

    4. Compute shared secret:
       DH1 = DH(IKa, SPKb)      ─── Identity × Signed Prekey
       DH2 = DH(EKa, IKb)       ─── Ephemeral × Identity
       DH3 = DH(EKa, SPKb)      ─── Ephemeral × Signed Prekey
       DH4 = DH(EKa, OPKb)      ─── Ephemeral × One-Time Prekey (optional)

    5. SK = HKDF(DH1 || DH2 || DH3 [|| DH4])

    6. Send initial message:
       → [IKa, EKa, OPK_id, ciphertext(SK)]
```

- **SPK (Signed Prekey)**: Medium-term rotated signed prekey
- **OPK (One-Time Prekey)**: Single-use prekey, deleted after use (enhances forward secrecy)
- **Prekey Management**: Client periodically publishes new SPK + batch OPK to the server

### Double Ratchet Message Encryption

```
    Root Chain:     RK₀ ──DH──▶ RK₁ ──DH──▶ RK₂ ──DH──▶ ...
                     │            │            │
    Sending Chain:  CKs₀──KDF──▶CKs₁──KDF──▶CKs₂
                     │            │            │
    Message Keys:   MK₀          MK₁          MK₂
                     │            │            │
    Encrypt:     plaintext    plaintext    plaintext
                     ↓            ↓            ↓
                  cipher₀     cipher₁     cipher₂
```

- **DH Ratchet**: On every conversation direction switch, exchange new DH public keys and advance the Root Key
- **Symmetric Ratchet**: Each message uses KDF to advance the Chain Key, deriving an independent Message Key
- **Skipped Keys**: Supports out-of-order reception, retaining up to 100 skipped keys
- **AEAD Additional Data (AAD)**: `v:{version};d:{deviceId};c:{counter}` prevents message reordering/tampering

### Encryption Algorithms

| Purpose | Algorithm | Nonce Length |
|---------|-----------|-------------|
| Message content | XChaCha20-Poly1305 | 192 bit |
| Contact secret / MK wrapping | AES-256-GCM | 128 bit |
| Key derivation | HKDF-SHA256 | — |
| Password hashing | Argon2id (m=64MB, t=3, p=4) | — |
| Signatures | Ed25519 | — |
| Key exchange curve | X25519 (via ed2curve) | — |
| Push preview encryption | ECDH P-256 + AES-256-GCM | 96 bit (IV) |
| Push preview key derivation | HKDF-SHA256 (info: `sentry-push-preview-v1`) | — |

### NFC Authentication (NTAG 424 DNA SDM)

```
NFC tag tap → UID + Counter + CMAC
                       ↓
              Worker: HKDF/EV2 key derivation (NTAG424_KM + salt)
                       ↓
              Worker: AES-CMAC verification (RFC 4493) → Counter monotonicity check (anti-replay)
                       ↓
              KV session issued (TTL 300s) + account token
```

- AES-CMAC uses Web Crypto API AES-CBC to emulate ECB (`nodejs_compat`)
- Supports both HKDF-SHA256 and EV2-CMAC key derivation modes
- Supports `NTAG424_KM_OLD` legacy key automatic fallback

### OPAQUE Password Authentication

- P-256 curve-based OPAQUE PAKE protocol (`@cloudflare/opaque-ts`)
- Runs entirely within Cloudflare Worker
- Two-phase flow: `register-init` → `register-finish` / `login-init` → `login-finish`
- `login-init` generated `expected` is temporarily stored in KV (TTL 120s); `login-finish` consumes then deletes it
- Server never holds plaintext passwords, preventing offline dictionary attacks
- Derives Session Key upon success

---

## Message Flow Architecture

### Dual-Path Model (A Route / B Route)

```
                          ┌─────────────────────────────┐
                          │     Entry Events             │
                          │  login / ws / enter /        │
                          │  resume / scroll             │
                          └──────────┬──────────────────┘
                                     │
                          ┌──────────▼──────────────────┐
                          │       Facade (Entry)         │
                          │  messages-flow/index.js      │
                          └──────────┬──────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                  │
         ┌──────────▼──────────┐           ┌──────────▼──────────┐
         │    A Route           │           │    B Route           │
         │    Replay (Vault)    │           │    Live Decrypt      │
         │                      │           │                      │
         │  mutateState=false   │           │  mutateState=true    │
         │  allowReplay=true    │           │  allowReplay=false   │
         │                      │           │                      │
         │  ● vaultGet only     │           │  ● Advance DR state  │
         │  ● AES-GCM decrypt   │           │  ● vaultPut incoming │
         │  ● No DR advance     │           │  ● persist snapshot  │
         │  ● No vaultPut       │           │  ● gap fill          │
         │                      │           │  ● catch-up          │
         └──────────────────────┘           └──────────────────────┘
```

### Send Flow

```
User inputs message
  ↓
sendDrPlaintext()              # dr-session.js
  ↓
Fetch peer prekey bundle        # X3DH (first exchange)
  ↓
x3dhInitiate() → shared secret  # Or use existing DR state
  ↓
drEncryptText() → encrypt       # Double Ratchet encryption
  ↓
enqueueDrSessionOp()           # Enqueue to outbox
  ↓
processOutboxJobNow()          # Batch processing
  ↓
atomicSend API                 # Atomic write: message + vault key
  ↓
Server D1 persistence          # messages_secure + message_key_vault
  ↓
WebSocket notify peer          # secure-message event (relayed via Durable Object)
```

### Receive Flow

```
WebSocket: "secure-message" event (Durable Object → Client)
  ↓
Facade: onWsIncomingMessageNew()
  ↓
Pipeline: B route processing
  ↓
DR state decrypt + advance
  ↓
vaultPut() → store incoming key  # For future A route replay
  ↓
persist DR snapshot              # Local + optional remote
  ↓
Timeline: add message            # Commit-driven
  ↓
Trigger notification / sound / unread count  # Only after commit
```

### Message Status

| Status | Symbol | Meaning |
|--------|--------|---------|
| Sent | ✓ | Sender has completed server persistence |
| Delivered | ✓✓ | Peer has completed live decrypt + vaultPut incoming |

---

## Database Schema

D1 (SQLite) with 27 tables (across 7 migrations). Below is the complete table structure:

### Accounts and Devices

```sql
accounts              # Account table
├── account_digest    # PK — SHA256 account digest
├── account_token     # API auth token
├── uid_digest        # UID hash (for SDM, UNIQUE)
├── last_ctr          # Last SDM counter (anti-replay)
├── wrapped_mk_json   # Encrypted Master Key (Argon2id + AES-GCM)
├── created_at        # Creation time
└── updated_at        # Update time

devices               # Device table
├── (account_digest, device_id)  # PK
├── label, status     # Device info (status defaults to 'active')
├── last_seen_at      # Last online
├── created_at        # Creation time
└── updated_at        # Update time

device_backup         # Device private key backup (encrypted)
├── account_digest    # PK (FK → accounts)
├── wrapped_dev_json  # Encrypted device private key
└── updated_at        # Auto-update trigger

device_signed_prekeys # X3DH SPK (Signed Prekeys)
├── (account_digest, device_id, spk_id)  # UNIQUE
├── spk_pub, spk_sig  # Public key and signature
└── ik_pub            # Identity Key public key

device_opks           # X3DH OPK (One-Time Prekeys)
├── (account_digest, device_id, opk_id)  # UNIQUE
├── opk_pub           # Public key
├── issued_at         # Issue time
└── consumed_at       # Consumption time (NULL = unused)
```

### Messages and Encryption

```sql
conversations         # Conversation table
├── id                # PK — Conversation ID
├── token_b64         # Conversation token
└── created_at        # Creation time

conversation_acl      # Conversation participants
├── (conversation_id, account_digest, device_id)  # PK
├── role              # Role
└── updated_at        # Auto-update trigger

messages_secure       # Encrypted messages
├── id                # PK — Message ID
├── conversation_id   # Conversation ID (FK)
├── sender_account_digest, sender_device_id    # Sender
├── receiver_account_digest, receiver_device_id # Receiver
├── header_json       # X3DH/DR header
├── ciphertext_b64    # Encrypted content
├── counter           # Per-conversation monotonically increasing
└── created_at        # Timestamp

message_key_vault     # Message Key Vault (E2EE replay)
├── (account_digest, conversation_id, message_id, sender_device_id)  # UNIQUE
├── target_device_id  # Target device
├── direction         # outgoing / incoming
├── msg_type          # Message type
├── header_counter    # Corresponding counter
├── wrapped_mk_json   # MK-wrapped message key
├── wrap_context_json # Wrapping context metadata
└── dr_state_snapshot # DR state snapshot (optional)

attachments           # Media attachments
├── object_key        # PK — R2 object path
├── conversation_id   # Conversation ID (FK)
├── message_id        # Message ID
├── sender_account_digest, sender_device_id  # Sender
├── envelope_json     # Encryption envelope
├── size_bytes        # File size
└── content_type      # MIME type

deletion_cursors      # Soft deletion cursors
├── (conversation_id, account_digest)  # PK
├── min_ts            # Minimum timestamp (deletion filter baseline)
└── updated_at        # Update time

conversation_deletion_log  # Conversation deletion log
├── id                # PK (auto-increment)
├── owner_digest      # Account
├── conversation_id   # Conversation ID
├── encrypted_checkpoint  # Encrypted deletion checkpoint
└── created_at        # Creation time
```

### Groups and Contacts

```sql
groups                # Groups
├── group_id          # PK
├── conversation_id   # Associated conversation (FK)
├── creator_account_digest  # Creator (FK → accounts)
├── name, avatar_json # Group info
└── created_at, updated_at

group_members         # Group members
├── (group_id, account_digest)  # PK
├── role              # owner / admin / member (CHECK)
├── status            # active / left / kicked / removed (CHECK)
├── inviter_account_digest  # Inviter
├── joined_at         # Join time
├── muted_until       # Mute expiry time
└── last_read_ts      # Last read timestamp

group_invites         # Group invites
├── invite_id         # PK
├── group_id          # Associated group (FK)
├── issuer_account_digest  # Issuer (FK, ON DELETE SET NULL)
├── secret            # Invite secret
├── expires_at        # Expiry time
└── used_at           # Use time

contacts              # Contacts (encrypted metadata)
├── (owner_digest, peer_digest)  # PK
├── encrypted_blob    # Encrypted contact data
├── is_blocked        # Block status
└── updated_at        # Update time

contact_secret_backups  # Contact secret backups
├── id                # PK (auto-increment)
├── account_digest    # Account
├── version           # Backup version
├── payload_json      # Backup content { payload, meta }
├── snapshot_version  # Snapshot version
├── entries, checksum, bytes  # Integrity info
├── device_label, device_id   # Source device
└── created_at, updated_at

invite_dropbox        # Offline invite dropbox
├── invite_id         # PK
├── owner_account_digest  # Owner (FK → accounts)
├── owner_device_id   # Owner device
├── owner_public_key_b64  # X3DH public key
├── expires_at        # Expiry time
├── status            # CREATED → DELIVERED → CONSUMED
├── delivered_by_account_digest  # Delivered by
├── ciphertext_json   # Encrypted initialization data
└── consumed_at       # Consumption time
```

### Calls

```sql
call_sessions         # Call sessions
├── call_id           # PK
├── caller_account_digest, callee_account_digest  # Account digests
├── status, mode      # Status and mode
├── capabilities_json # Device capabilities
├── metadata_json     # Additional metadata
├── metrics_json      # Call quality metrics
├── connected_at, ended_at  # Connect/end time
├── end_reason        # End reason
├── expires_at        # Expiry time
└── last_event        # Last event type

call_events           # Call events
├── event_id          # PK
├── call_id           # Associated call (FK)
├── type              # Event type
├── payload_json      # Event data
├── from_account_digest, to_account_digest  # Both parties
└── trace_id          # Trace ID
```

### Authentication and Subscriptions

```sql
opaque_records        # OPAQUE authentication records
├── account_digest    # PK
├── record_b64        # OPAQUE auth record
├── client_identity   # Client identity
└── created_at, updated_at

subscriptions         # Subscriptions
├── digest            # PK — Account digest
├── expires_at        # Expiry time
└── created_at, updated_at

tokens                # Subscription tokens
├── token_id          # PK
├── digest            # Account digest
├── extend_days       # Extension days
├── nonce, key_id     # Verification info
├── signature_b64     # Signature
├── status            # Status
└── used_at, used_by_digest  # Usage record

extend_logs           # Extension logs
├── id                # PK (auto-increment)
├── token_id, digest  # Token and account
├── extend_days       # Extension days
└── expires_at_after  # Post-extension expiry time

media_objects         # Media object tracking
├── obj_key           # PK — S3 object path
├── conv_id, sender_id  # Conversation and sender
├── size_bytes        # File size
└── content_type      # MIME type
```

---

## API Endpoints

> All API endpoints are handled by Cloudflare Workers; the frontend connects directly to the Worker URL.

### Authentication (`/api/v1/auth/`)

| Endpoint | Method | Description | State Storage |
|----------|--------|-------------|---------------|
| `/auth/sdm/exchange` | POST | NFC tag SDM authentication → account token | KV session (TTL 300s) |
| `/auth/sdm/debug-kit` | POST | Generate test SDM credentials | KV counter (TTL 24h) |
| `/auth/brand` | GET | Brand query (for splash) | — |
| `/auth/opaque/register-init` | POST | OPAQUE registration init | — |
| `/auth/opaque/register-finish` | POST | OPAQUE registration complete → D1 | — |
| `/auth/opaque/login-init` | POST | OPAQUE login init | KV expected (TTL 120s) |
| `/auth/opaque/login-finish` | POST | OPAQUE login complete → Session Key | KV consumed then deleted |
| `/auth/opaque/debug` | GET | OPAQUE config debug (non-sensitive info) | — |
| `/mk/store` | POST | Store wrapped MK (first-time setup, consumes session) | KV session single-use |
| `/mk/update` | POST | Update wrapped MK (password change) | — |

### Key Management (`/api/v1/keys/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/keys/publish` | POST | Publish prekeys (SPK + OPK batch) |
| `/keys/bundle` | POST | Fetch peer prekey bundle (for X3DH, requires `peer_account_digest`) |
| `/devkeys/store` | POST | Store device key backup (AEAD or Argon2id envelope) |
| `/devkeys/fetch` | POST | Fetch device key backup |

### Messages (`/api/v1/messages/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/messages/secure` | POST | Send encrypted message |
| `/messages/atomic-send` | POST | Atomic send (message + vault key written together) |
| `/messages` | POST | Create standard message |
| `/messages/secure` | GET | Fetch encrypted message list |
| `/messages/probe` | GET | Message probe endpoint (returns `{probe: 'ok'}`) |
| `/messages/secure/max-counter` | GET | Get conversation max counter |
| `/messages/by-counter` | GET | Get specific message by counter |
| `/conversations/:convId/messages` | GET | Get messages for specified conversation |
| `/messages/send-state` | POST | Get message send state |
| `/messages/outgoing-status` | POST | Batch get outgoing status |
| `/messages/delete` | POST | Delete message |
| `/messages/secure/delete-conversation` | POST | Delete entire conversation |
| `/deletion/cursor` | POST | Set soft deletion cursor |

### Media (`/api/v1/media/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/media/sign-put` | POST | Get R2 upload Presigned URL (single file) |
| `/media/sign-get` | POST | Get R2 download Presigned URL (single file) |
| `/media/sign-put-chunked` | POST | Get chunked upload Presigned URLs (baseKey + manifest + chunks, max 2000 chunks) |
| `/media/sign-get-chunked` | POST | Get chunked download Presigned URLs (supports specifying chunk_indices) |
| `/media/cleanup-chunked` | POST | Delete all objects under baseKey (cancel/error cleanup) |

### Calls (`/api/v1/calls/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/calls/invite` | POST | Initiate call invite |
| `/calls/cancel` | POST | Cancel call |
| `/calls/ack` | POST | Acknowledge call event |
| `/calls/report-metrics` | POST | Report call quality metrics |
| `/calls/turn-credentials` | POST | Get TURN credentials (dynamic, time-limited) |
| `/calls/network-config` | GET | Get STUN/TURN network config |
| `/calls/:callId` | GET | Get call session details |

### Contacts and Invites

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/contacts/uplink` | POST | Upload contacts (encrypted upsert) |
| `/contacts/downlink` | POST | Download contact snapshot |
| `/contacts/avatar/sign-put` | POST | Get avatar upload Presigned URL (max 5MB) |
| `/contacts/avatar/sign-get` | POST | Get avatar download Presigned URL |
| `/contact-secrets/backup` | POST | Backup contact secrets |
| `/contact-secrets/backup` | GET | Restore contact secrets |
| `/invites/create` | POST | Create Invite Dropbox |
| `/invites/deliver` | POST | Deliver invite (guest → owner) |
| `/invites/consume` | POST | Consume invite (owner retrieves) |
| `/invites/confirm` | POST | Confirm invite received |
| `/invites/unconfirmed` | POST | List unconfirmed invites |
| `/invites/status` | POST | Query invite status |

### Groups (`/api/v1/groups/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/groups/create` | POST | Create group |
| `/groups/members/add` | POST | Add group member |
| `/groups/members/remove` | POST | Remove group member |
| `/groups/:groupId` | GET | Get group details |

### Message Key Vault (`/api/v1/message-key-vault/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/message-key-vault/put` | POST | Store message key in vault |
| `/message-key-vault/get` | POST | Retrieve message key from vault |
| `/message-key-vault/latest-state` | POST | Get latest DR state snapshot |
| `/message-key-vault/count` | POST | Get vault key count |
| `/message-key-vault/delete` | POST | Delete keys from vault |

### Subscriptions (`/api/v1/subscription/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/subscription/redeem` | POST | Redeem subscription code |
| `/subscription/validate` | POST | Validate subscription |
| `/subscription/status` | GET | Get subscription status |
| `/subscription/token-status` | GET | Get token status |

### Admin (`/api/v1/admin/`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/purge-account` | POST | Purge account data (requires HMAC `x-auth` header) |

### Miscellaneous

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/friends/delete` | POST | Delete contact |
| `/ws/token` | POST | Get WebSocket JWT token |
| `/account/evidence` | GET | Get account info |
| `/health` | GET | Health check |
| `/status` | GET | Service status |

---

## WebSocket Real-Time Communication

### Architecture

WebSocket connections are managed by **Cloudflare Durable Objects** (`AccountWebSocket` class). Each account corresponds to a Durable Object instance, supporting multiple simultaneous device connections for the same account.

```
Client                          Worker                         Durable Object
  │                                │                               │
  │── POST /ws/token ─────────────▶│                               │
  │◀── JWT token ─────────────────│                               │
  │                                │                               │
  │── WebSocket /ws ──────────────▶│── Upgrade ──────────────────▶│
  │                                │                               │
  │◀─── hello (server greeting) ──────────────────────────────────│
  │──── auth (JWT token) ─────────────────────────────────────────▶│
  │◀─── auth_ok / auth_fail ─────────────────────────────────────│
  │                                                                │
  │◀─── secure-message / call-invite / presence-update ───────────│
```

### Message Types

#### Connection and Authentication

| Type | Direction | Description |
|------|-----------|-------------|
| `hello` | S→C | Server greeting (includes timestamp) |
| `auth` | C→S | JWT authentication request (token) |
| `auth` | S→C | Authentication result (ok/fail + reason, exp, reused) |
| `ping` | C→S | Heartbeat probe |
| `pong` | S→C | Heartbeat response (includes timestamp) |

#### Message Notifications

| Type | Direction | Description |
|------|-----------|-------------|
| `secure-message` | S→C | New encrypted message notification (includes counter, sender/target digest, deviceId) |
| `message-new` | C→S | Notify peer of new message (includes preview, ts, count) |
| `vault-ack` | C→S / S→C | Key vault write confirmation (bidirectional relay) |
| `contacts-reload` | C→S / S→C | Contact list update notification |
| `contact-removed` | C→S / S→C | Contact deletion notification (includes conversationId) |
| `conversation-deleted` | C→S / S→C | Conversation deletion notification |
| `invite-delivered` | S→C | Invite delivery notification (includes inviteId) |
| `force-logout` | S→C | Forced logout (account purge, etc.) |

#### Call Signaling

| Type | Direction | Description |
|------|-----------|-------------|
| `call-invite` | S↔C | Call invitation |
| `call-ringing` | S↔C | Ringing |
| `call-accept` | S↔C | Answer |
| `call-reject` | S↔C | Reject |
| `call-cancel` | S↔C | Cancel |
| `call-busy` | S↔C | Busy |
| `call-end` | S↔C | End |
| `call-offer` | S↔C | SDP Offer (max 64KB) |
| `call-answer` | S↔C | SDP Answer (max 64KB) |
| `call-ice-candidate` | S↔C | ICE candidate |
| `call-media-update` | S↔C | Media state update |
| `call-error` | S→C | Call error notification |
| `call-event-ack` | S→C | Call event acknowledgment |

#### Presence

| Type | Direction | Description |
|------|-----------|-------------|
| `presence-subscribe` | C→S | Subscribe to online status (accountDigests array) |
| `presence` | S→C | Online status list (initial response) |
| `presence-update` | S→C | Online status change (single account) |

### Payload Limits

| Item | Limit |
|------|-------|
| General signaling JSON | 16 KB |
| SDP descriptions | 64 KB (supports Safari extended codec) |
| String fields | 128–4096 bytes (varies by field) |

---

## Web Push Notifications

### Architecture Overview

```
 Sender                    Cloudflare Worker (DO)              Receiver Device
┌────────┐  POST /messages  ┌──────────────────────┐  Web Push API  ┌─────────────┐
│ Client │ ───────────────▶ │ notifyAccountDO()    │ ────────────▶  │ Service     │
│  E2E   │  encrypted_      │   ↓                  │                │ Worker (SW) │
│ encrypt│  previews{}      │ _sendPushNotifications│                │   ↓         │
└────────┘                  │   ↓ VAPID + AES-GCM  │                │ E2E decrypt │
                            │   ↓ RFC 8291/8292    │                │ → showNotify│
                            └──────────────────────┘                └─────────────┘
```

Push notifications are based on the W3C Push API standard, using VAPID authentication (RFC 8292) and AES-128-GCM transport encryption (RFC 8291). The entire push flow is completed within Cloudflare Workers Durable Objects, with no dependency on third-party push services.

Push notification preview content (sender name, message summary, message type) is **end-to-end encrypted**: the sender encrypts preview content using the receiver's device ECDH P-256 public key (AES-256-GCM), the server only relays ciphertext, and the Service Worker decrypts locally using the device private key before displaying the notification.

### Delivery Trigger — Offline-Gated, Web Push + APNs

Background push is an **offline** delivery mechanism. Inside the recipient's `AccountWebSocket` Durable Object, `/notify` first broadcasts the message to any live WebSocket connections. Push fan-out runs **only when no active connection received the message** (`sent === 0`); when the recipient is online the live socket already delivered it, so no duplicate push is sent. This single chokepoint covers both delivery paths — the HTTP path (`notifyAccountDO → /notify`) and the real-time WebSocket relay path (sender DO `_relayToTarget → /notify`) — so each message triggers at most one fan-out.

When the recipient is offline, the Durable Object fans out over **both transports in parallel**:

| Transport | Source table | Audience |
|-----------|--------------|----------|
| Web Push (VAPID / RFC 8291) | `push_subscriptions` | Browser / home-screen PWA |
| APNs (token-based ES256) | `apns_tokens` | Native iOS app / App Clip (WKWebView cannot receive Web Push) |

Both transports share the same Layer-1/Layer-2 type filtering and per-device encrypted preview (`encrypted_previews[device_id]`), and both auto-prune invalid endpoints/tokens on 404/410 (or `BadDeviceToken`/`Unregistered`).

### E2E Push Preview Encryption

```
Sender                                               Receiver (Service Worker)
──────                                               ───────────────────────
1. Fetch receiver device public keys                 1. Receive push payload (ciphertext)
   GET /d1/push/preview-keys                            ↓
       ↓                                             2. Load device private key from IndexedDB
2. Generate Ephemeral ECDH P-256 keypair                ↓
       ↓                                             3. ECDH(device_private, ephemeral_public)
3. ECDH(ephemeral_private, device_public)                → shared secret
   → shared secret                                      ↓
       ↓                                             4. HKDF-SHA256(shared, info="sentry-push-preview-v1")
4. HKDF-SHA256(shared, info="sentry-push-preview-v1")    → AES-256-GCM key
   → AES-256-GCM key                                    ↓
       ↓                                             5. AES-256-GCM decrypt
5. AES-256-GCM encrypt {title, body, msgType}            → {title, body, msgType}
       ↓                                                ↓
6. Compose: [ephemeral_pub(65B) | IV(12B) | ciphertext] 6. Display notification
       ↓
7. Base64URL encode → encrypted_previews[device_id]
```

| Property | Description |
|----------|-------------|
| Encryption algorithm | ECDH P-256 + HKDF-SHA256 + AES-256-GCM |
| Key isolation | Each device has an independent ECDH key pair; private key stored only in device IndexedDB |
| Forward secrecy | Each encryption uses a new ephemeral keypair |
| Server zero-knowledge | Server stores only device public keys; cannot decrypt preview content |
| Wire Format | `[ephemeral P-256 pubkey (65B)] + [IV (12B)] + [ciphertext + GCM tag (16B)]` |

### Privacy Design

| Principle | Description |
|-----------|-------------|
| Preview E2E encrypted | Push preview content (sender, message summary) encrypted with receiver's device public key; server only relays ciphertext |
| Fallback zero-content | If device has no registered preview public key or decryption fails, push payload contains only `{ title: "SENTRY MESSENGER" }`, exposing no content |
| Client-side i18n | Notification text is resolved locally by the Service Worker based on receiver's `navigator.language`; server transmits no locale information |
| Subscription isolation | Each `account_digest` independently manages subscription endpoints; Durable Object isolation ensures no cross-account leakage |

### Message Type Filtering

Not all messages trigger push notifications. The server applies two-layer filtering:

**Layer 1 — Notification Type Allowlist**

Only the following 5 notification types are allowed to trigger push:

| Notification Type | Description |
|-------------------|-------------|
| `secure-message` | 1:1 encrypted message |
| `message-new` | General new message |
| `biz-conv-message` | Group conversation message |
| `call-invite` | Call invitation |
| `notify` | System notification |

**Layer 2 — Control Message Exclusion**

Even if the notification type passes Layer 1, if the message's `msgType` (extracted from `header_json`) is one of the following control types, push is not sent:

```
read-receipt, delivery-receipt, session-init, session-ack, session-error,
profile-update, contact-share, conversation-deleted, placeholder
```

### Multi-Language Support (i18n)

The Service Worker embeds a translation dictionary and automatically selects notification text based on the receiver's browser locale:

| Locale | Notification Content |
|--------|---------------------|
| `en` | You have a new message |
| `zh-Hant` | 你有一則新訊息 |
| `zh-Hans` | 你有一条新消息 |
| `ja` | 新しいメッセージがあります |
| `ko` | 새 메시지가 있습니다 |
| `th` | คุณมีข้อความใหม่ |
| `vi` | Bạn có tin nhắn mới |

Locale resolution logic is consistent with the main app's `locales/index.js` (BCP-47 normalization); unsupported locales automatically fall back to English.

### Subscription Management

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Register subscription | `POST /d1/push/subscribe` | Store endpoint + p256dh + auth + preview_public_key in `push_subscriptions` |
| Unsubscribe | `POST /d1/push/unsubscribe` | Remove specified endpoint |
| List subscriptions | `POST /d1/push/list` | List all push subscriptions under the account |
| Preview public key query | `POST /d1/push/preview-keys` | Get preview encryption public keys for all receiver devices (used by sender) |
| PIN generation | `POST /d1/push/pin/generate` | Generate 6-digit PIN code (for iOS PWA subscription) |
| PIN verification | `POST /d1/push/pin/verify` | Verify PIN and complete subscription (iOS PWA) |
| Register APNs token | `POST /d1/push/apns/subscribe` | Store native iOS APNs device token in `apns_tokens` |
| Unregister APNs token | `POST /d1/push/apns/unsubscribe` | Remove an APNs device token |
| Unified fan-out (HMAC) | `POST /d1/push/send` | Send a background push to an account across Web Push + APNs |
| Auto-cleanup | — | Automatically deletes invalid subscriptions/tokens upon receiving 404/410 (or BadDeviceToken/Unregistered) during push |

### Platform Compatibility

| Platform | Support Status | Notes |
|----------|---------------|-------|
| Chrome / Edge (Desktop & Android) | Fully supported | Receives notifications even after browser is closed |
| Firefox (Desktop & Android) | Fully supported | |
| Safari (macOS 13+) | Fully supported | Requires notification permission |
| iOS Safari (16.4+) | PWA mode supported | Must first Add to Home Screen; supports PIN code subscription flow |

### Related Files

| File | Description |
|------|-------------|
| `web/src/sw.js` | Service Worker — push reception, E2E preview decryption, i18n, notification display |
| `web/src/app/crypto/push-preview.js` | Push preview E2E encryption/decryption (ECDH P-256 + AES-256-GCM) |
| `web/src/app/features/push-preview-keys.js` | Push preview key management (generation, storage, registration) |
| `web/src/app/features/push-subscription.js` | Push subscription lifecycle management |
| `web/src/app/features/queue/outbox.js` | Sender — fetches receiver public keys and encrypts preview |
| `data-worker/src/account-ws.js` | Durable Object — `_sendPushNotifications()` push delivery |
| `data-worker/src/web-push.js` | VAPID JWT + AES-128-GCM transport encryption implementation (RFC 8291/8292) |
| `data-worker/migrations/0015_add_push_subscriptions.sql` | Push subscription table schema (includes `preview_public_key` column) |
| `web/src/app/ui/mobile/modals/push-modal.js` | Frontend push settings UI |

---

## Security Design Principles

### Strict Cryptographic Protocol — No Fallback Policy

This project follows a **strict cryptographic protocol** that prohibits any fallback, retry, rollback, resync, or auto-repair logic:

| Rule | Description |
|------|-------------|
| Decryption failure | Fail immediately; do not attempt backup keys |
| Counter mismatch | Reject immediately (409 CounterTooLow); do not auto-align |
| Protocol downgrade | Using older versions/keys for retry is prohibited |
| Fuzzy error handling | try-catch fallback is not allowed |
| Conversation reset | Must be an explicit operation; no implicit state rebuilding |

### Server-Side Data Handling

The server does not hold decryption keys for message content. Communication metadata (social graph, timestamps, etc.) remains visible to the server (see [Metadata Exposure](docs/security/metadata-exposure.md) for details):

- Messages stored as `ciphertext_b64` + `header_json`; decryption keys exist only on the client
- Contact data stored as `encrypted_blob`; decryption keys exist only on the client
- Master Key stored wrapped with Argon2id + AES-GCM; requires the user's password to unwrap

### Commit-driven Side Effects

- **Notifications/unread/sounds** — Only triggered after B route commit (vaultPut + DR snapshot success)
- **Placeholder reveal** — Only replaced after commit
- WebSocket/fetch/probe do not directly produce user-visible side effects

### Counter Integrity

- Each conversation maintains a **monotonically increasing counter**
- Server-side enforcement: `counter > max_counter`
- Client-side per-conversation serialized processing to prevent parallel advancement

---

## Security Audit & Threat Model

This project maintains comprehensive security documentation. All analyses are based on actual code scanning and traceable to specific code locations.

### Architecture and Protocol

| Document | Description |
|----------|-------------|
| [Protocol Overview](docs/security/protocol-overview.md) | Actual implementation status of all system protocols, covering registration, X3DH, Double Ratchet, message transport, and other complete flows |
| [Security Architecture](docs/security/security-architecture.md) | Overall security architecture analysis, including encryption layers, trust boundaries, data flows, and security properties of each component |
| [Key Management](docs/security/key-management.md) | Complete inventory of all key types — purpose, generation method, storage location, lifecycle, and rotation mechanism |
| [Message Lifecycle](docs/security/message-lifecycle.md) | Complete security lifecycle tracking of a message from send to receive |
| [Media & Attachment Security](docs/security/media-and-attachment-security.md) | Complete security analysis of media files from selection, encryption, chunked upload to streaming decryption playback |

### Threat Model and Risk Assessment

| Document | Description |
|----------|-------------|
| [Threat Model](docs/security/threat-model.md) | Threat model definition — attacker capability assumptions, security objectives, protection scope |
| [Trust Boundaries](docs/security/trust-boundaries.md) | Analysis of trust boundaries and trust relationships between components in the system |
| [Metadata Exposure](docs/security/metadata-exposure.md) | Inventory of metadata visible to the server, storage layer, and network observers |
| [Data Classification](docs/security/data-classification.md) | Classification of all data types in the system by confidentiality level (C1–C5) |
| [Security Assumptions & Out of Scope](docs/security/security-assumptions-and-out-of-scope.md) | Explicit distinction between what the system commits to protect and what it does not |

### Audit and Findings

| Document | Description |
|----------|-------------|
| [Security Review Checklist](docs/security/security-review-checklist.md) | Item-by-item checklist for internal or third-party audits, each item linked to specific code locations |
| [Security Findings by Severity](docs/security/security-findings-by-severity.md) | All security findings sorted by severity (Critical → Low), with remediation status tracking |
| [Repo Findings Summary](docs/security/repo-findings-summary.md) | Security findings summary from complete repository scanning |
| [Audit Readiness](docs/security/audit-readiness.md) | Readiness assessment of each module for third-party security audit |
| [Known Limitations](docs/security/known-limitations.md) | Known limitations and incompletely implemented security properties (honest disclosure) |
| [Open Questions](docs/security/open-questions.md) | Unresolved questions discovered during scanning, pending further confirmation |

### Supply Chain Integrity

The security boundary of an E2EE product is the client-side code itself. To ensure the bundle users execute has not been tampered with and is independently verifiable:

#### Public Verification Endpoint

```
GET /.well-known/sentry-build.json
```

Returns complete build metadata for the current deployment:

| Field | Content |
|-------|---------|
| `build.commit` | Full Git commit SHA at build time |
| `build.timestamp` | Build time (ISO 8601) |
| `build.builder` | CI environment (`github-actions` / `local`) |
| `hashes.algorithm` | `sha256` |
| `hashes.aggregate` | Aggregate hash of all file hashes (single value representing the entire deployment) |
| `hashes.files` | Individual SHA-256 hash for each dist/ file |
| `sri` | SRI values for main JS/CSS (SHA-384) |
| `service_worker.hash` | SHA-256 hash of `sw.js` |

#### Reproducible Build

Anyone can rebuild from the same commit and obtain byte-identical output:

```bash
git checkout <commit-from-sentry-build.json>
cd web && npm ci && npm run build
npm run verify   # Automatically compares all hashes
```

See [Reproducible Build documentation](docs/security/reproducible-build.md) for details.

#### Security Policies

| Policy | Document | Key Points |
|--------|----------|------------|
| Canary deployment prohibited | [canary-policy.md](docs/security/canary-policy.md) | All users receive the same bundle simultaneously; staged/segmented deployment is prohibited |
| Service Worker update policy | [sw-update-policy.md](docs/security/sw-update-policy.md) | `skipWaiting` + `clients.claim` for immediate activation; used only for push, no offline caching |
| Emergency revocation plan | [emergency-revoke-plan.md](docs/security/emergency-revoke-plan.md) | IR process upon compromise (rollback → SW forced update → key rotation → notification) |

#### CI/CD Hardening

| Measure | Status |
|---------|--------|
| `npm ci` (locked dependency tree) | ✅ Implemented (web + worker) |
| Post-build hash verification (`verify-build.mjs`) | ✅ Implemented (aggregate hash; cosign/SLSA verification pending integration) |
| SRI injection for all entry scripts | ✅ Implemented |
| `sentry-build.json` auto-generation | ✅ Implemented |
| SLSA provenance (Level 2) | ✅ Implemented |
| cosign / Sigstore signatures | ✅ Implemented |
| Public build hash log (Rekor) | ✅ Implemented |
| Independent build monitor | ✅ Implemented (aggregate hash comparison; signature verification pending integration) |

---

## Horizontal Deployment & Scaling Advantages

### From VPS to Fully Serverless Architecture Migration

The original architecture used Node.js Express + WebSocket deployed on a Linode VPS (managed by PM2), with the following limitations: single server handling all connections, difficulty in manual horizontal scaling, WebSocket sticky session issues, and the need for manual server operations (OS updates, SSL, monitoring, backups).

After migrating to Cloudflare Workers + Durable Objects, a fully serverless architecture was achieved:

### Auto-Elastic Scaling

| Aspect | VPS Architecture (Old) | Workers Architecture (New) |
|--------|----------------------|---------------------------|
| API request handling | Single VPS, PM2 cluster | Cloudflare global edge network auto-distribution |
| WebSocket connections | Single VPS capacity limit | Durable Objects per-account isolation, no limit |
| Scaling method | Manual machine addition + Load Balancer | Zero-config auto-scaling |
| Cold start | N/A (resident process) | Millisecond cold start (Worker isolate) |

### Global Edge Deployment

- **Reduced API latency** — Cloudflare Workers deployed across 300+ global nodes; users automatically connect to the nearest edge node for API request processing
- **WebSocket proximity** — Durable Objects automatically assigned to the nearest data center by account, reducing signaling latency
- **D1 smart routing** — SQLite database automatically replicates read replicas to the edge, reducing query latency

### Zero Operations Overhead

| Item | VPS Architecture (Old) | Workers Architecture (New) |
|------|----------------------|---------------------------|
| Server operations | OS updates, security patches, monitoring | Completely maintenance-free |
| SSL certificates | Manual management or Let's Encrypt | Cloudflare auto-managed |
| Process management | PM2 daemon, OOM monitoring | Platform auto-managed |
| Deployment flow | SSH + git pull + PM2 reload | `wrangler deploy` (zero downtime) |
| High availability | Manual redundancy setup required | Platform built-in, auto failover |
| DDoS protection | Additional setup required | Cloudflare built-in protection |

### Durable Objects — The Optimal Solution for Stateful WebSocket

The pain point of traditional WebSocket horizontal scaling is **sticky sessions**: multiple connections from the same account must be routed to the same server for correct message forwarding. Durable Objects naturally solve this problem:

- **Per-account isolation** — Each account corresponds to one `AccountWebSocket` instance; all device WebSocket connections are automatically routed to the same DO
- **Hibernatable API** — DOs automatically hibernate when inactive (consuming no compute resources) and wake in milliseconds when a message arrives
- **Built-in persistence** — DOs can use Transactional Storage to persist Presence state without external Redis
- **Auto-migration** — Cloudflare automatically migrates DOs to the optimal data center with no manual management required

### Cost Efficiency

| Item | VPS Architecture (Old) | Workers Architecture (New) |
|------|----------------------|---------------------------|
| Fixed cost | VPS monthly rent (regardless of traffic) | Pay-per-use (request count + CPU time) |
| Low traffic | Still paying fixed costs | Near-zero cost |
| Traffic spikes | May crash or require emergency scaling | Auto-scales, pay-per-use |
| Operations labor | Requires DevOps investment | Zero operations cost |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- Cloudflare account (Workers + D1 + R2 + KV + Pages)
- Wrangler CLI (`npm install -g wrangler`)

### Local Development

```bash
# Install dependencies
npm install
cd web && npm install && cd ..

# Start Worker local dev (D1 + KV + Durable Objects)
cd data-worker && npx wrangler dev

# ─── Another terminal ───

# Frontend dev mode (raw copy, no minification)
cd web && npm run build:raw

# Or use Wrangler local preview
cd web && npm run preview
```

### Frontend Build

```bash
cd web
npm run build        # esbuild bundle (minify + code splitting) → dist/
npm run build:raw    # Direct copy src → dist (for development)
npm run verify       # Build integrity verification
npm run verify:cdn   # CDN integrity verification (verbose)
npm run preview      # Wrangler Pages local preview
```

---

## Deployment

### Architecture Overview

```
GitHub Push (main)
  │
  ├── deploy-worker    # Cloudflare Worker (D1 migrations + wrangler deploy + secrets)
  └── deploy-pages     # Cloudflare Pages (npm build → wrangler pages deploy ./dist)
```

Only two deployment targets required, no server operations.

### GitHub Actions CI/CD

```yaml
deploy.yml (main branch):
  ├── job: changes         # dorny/paths-filter detects changed paths
  ├── job: deploy-worker   # data-worker/** changes → D1 migrations + wrangler deploy + secrets
  └── job: deploy-pages    # web/** changes → npm build + wrangler pages deploy

deploy-uat.yml (non-main branches):
  ├── job: deploy-worker   # --env uat → message-data-uat
  └── job: deploy-pages    # --env uat → UAT Pages
```

### Worker Deployment

```bash
cd data-worker

# Apply D1 database migrations
wrangler d1 migrations apply message_db --remote

# Deploy Worker
wrangler deploy

# Set Secrets (first time or on change)
wrangler secret put OPAQUE_OPRF_SEED
wrangler secret put OPAQUE_AKE_PRIV_B64
wrangler secret put OPAQUE_AKE_PUB_B64
wrangler secret put NTAG424_KM
wrangler secret put DATA_API_HMAC
wrangler secret put ACCOUNT_HMAC_KEY
wrangler secret put INVITE_TOKEN_KEY
wrangler secret put PORTAL_HMAC_SECRET
wrangler secret put S3_ACCESS_KEY
wrangler secret put S3_SECRET_KEY
wrangler secret put WS_TOKEN_SECRET
wrangler secret put PRIVATE_KEY_PUBLIC_PEM
wrangler secret put APNS_KEY_P8     # contents of AuthKey_XXXX.p8 (native iOS push)
wrangler secret put APNS_KEY_ID
```

### Pages Deployment

```bash
cd web

# Bundle mode
npm run build && wrangler pages deploy ./dist --project-name message-web-hybrid

# Raw mode (for development)
wrangler pages deploy ./src
```

### Frontend Bundle Features

- **esbuild** ES2022 target with code splitting + minification + source maps
- **SRI** (Subresource Integrity) — SHA384 integrity hashes injected into all JS/CSS
- **Build Manifest** — `dist/build-manifest.json` contains git commit hash + per-file SHA256
- **Entry Points**: `app-mobile.js`, `login-ui.js`, `debug-page.js`, `media-permission-demo.js`
- **CSS Bundle**: `app-bundle.css` single minified file

---

## Testing

```bash
# ─── Integration tests (scripts/) ───
npm run test:login-flow          # Complete authentication flow
npm run test:prekeys-devkeys     # X3DH prekey management
npm run test:messages-secure     # Secure message encrypt/decrypt
npm run test:friends-messages    # Friend messaging send/receive
npm run test:calls-encryption    # Call encryption

# ─── E2E tests (Playwright) ───
npm run test:front:login         # Login UI smoke test

# ─── Unit tests ───
node --test tests/unit/          # All unit tests

# ─── Simulation tests ───
node tests/dr-offline-sim.mjs    # Double Ratchet offline simulation

# ─── Frontend verification ───
cd web && npm run verify         # Build integrity verification
cd web && npm run verify:cdn     # CDN integrity verification (verbose)
```

### Test Coverage

| Category | Test Items |
|----------|-----------|
| Authentication | SDM exchange, OPAQUE registration/login, MK storage |
| Keys | SPK/OPK publishing, bundle retrieval, device key backup |
| Messages | Encrypted sending, atomic write, counter verification, deletion |
| Friends | Contact deletion, message send/receive |
| Calls | Encrypted signaling, TURN credentials |
| Frontend | Login flow, contact encryption, timeline precision, encoding, snapshot normalization |
| Simulation | Double Ratchet offline simulation |

---

## Environment Variables

> All backend environment variables are configured in Cloudflare Workers (`wrangler.toml` or `wrangler secret put`).

### Worker Public Config (wrangler.toml `[vars]`)

| Variable | Description | Example |
|----------|-------------|---------|
| `OPAQUE_SERVER_ID` | OPAQUE server identifier | `api.message.sentry.red` |
| `NTAG424_KDF` | NFC key derivation mode | `HKDF` / `EV2` |
| `NTAG424_SALT` | HKDF salt | `sentry.red` |
| `NTAG424_INFO` | HKDF info | `ntag424-slot-0` |
| `NTAG424_KVER` | Key version | `1` |
| `S3_ENDPOINT` | R2 / S3-compatible endpoint URL | `https://xxx.r2.cloudflarestorage.com` |
| `S3_REGION` | S3 region | `auto` |
| `S3_BUCKET` | Bucket name | `message-media` |
| `SIGNED_PUT_TTL` | Upload signed URL validity (seconds) | `900` |
| `SIGNED_GET_TTL` | Download signed URL validity (seconds) | `900` |

### Worker Secrets (`wrangler secret put`)

| Variable | Description |
|----------|-------------|
| `OPAQUE_OPRF_SEED` | OPRF seed (32 bytes hex) |
| `OPAQUE_AKE_PRIV_B64` | OPAQUE AKE private key (base64) |
| `OPAQUE_AKE_PUB_B64` | OPAQUE AKE public key (base64) |
| `NTAG424_KM` | NFC master key (16 bytes hex) |
| `NTAG424_KM_OLD` | NFC old master key (fallback) |
| `DATA_API_HMAC` | API HMAC authentication key |
| `ACCOUNT_HMAC_KEY` | Account HMAC key |
| `INVITE_TOKEN_KEY` | Invite token key |
| `PORTAL_HMAC_SECRET` | Portal HMAC secret |
| `S3_ACCESS_KEY` | R2/S3 access key |
| `S3_SECRET_KEY` | R2/S3 secret key |
| `WS_TOKEN_SECRET` | WebSocket JWT signing key (>= 32 characters) |
| `PRIVATE_KEY_PUBLIC_PEM` | RS256 public key for verifying top-up voucher JWTs (matches Portal `PRIVATE_KEY_PEM`) |
| `APNS_KEY_P8` | APNs auth key (.p8 contents) for native iOS push |
| `APNS_KEY_ID` | APNs key ID (10-char) for the .p8 |

### D1 Database Binding

| Binding | Purpose |
|---------|---------|
| `DB` | D1 SQLite database (message_db) |

### KV Namespace Binding

| Binding | Purpose | TTL |
|---------|---------|-----|
| `AUTH_KV` | SDM exchange session, OPAQUE login expected, debug counter, Presence | 120s–300s |

```bash
# Create KV namespace
wrangler kv namespace create AUTH_KV
wrangler kv namespace create AUTH_KV --env uat
# Enter the generated id into wrangler.toml
```

### Durable Objects Binding

| Binding | Class | Purpose |
|---------|-------|---------|
| `ACCOUNT_WS` | `AccountWebSocket` | Per-account WebSocket connection management |

### WebRTC Calls (Worker Secrets)

| Variable | Description |
|----------|-------------|
| `CLOUDFLARE_TURN_TOKEN_ID` | Cloudflare TURN token ID |
| `CLOUDFLARE_TURN_TOKEN_KEY` | Cloudflare TURN token key |

---

## Tech Stack

### Worker Dependencies

| Package | Purpose |
|---------|---------|
| @cloudflare/opaque-ts | OPAQUE PAKE protocol (P-256) |
| node:crypto (nodejs_compat) | AES-CMAC / HKDF-SHA256 / HMAC / JWT verification |

### Frontend Tools and Technologies

| Tool / Technology | Purpose |
|-------------------|---------|
| esbuild | JS bundling (ES2022, code splitting, minify, SRI) |
| Vanilla JS | Framework-free SPA |
| Cloudflare Pages | Static deployment (with Pages Functions API proxy) |
| WebRTC | P2P audio/video calls (ECDSA P-256 DTLS) |
| InsertableStreams | Call E2EE per-frame encryption (AES-GCM) |
| MediaPipe Face Detection | Face detection WASM (BlazeFace TFLite, @mediapipe/tasks-vision) |
| WebCodecs | Video transcoding (HEVC/VP9 → H.264 fMP4) |
| MediaSource Extensions | Encrypted video real-time streaming playback (includes ManagedMediaSource for iOS) |
| mp4box.js | MP4 demux/mux (for transcoding + remux) |
| Canvas captureStream | Video face/background blur pipeline |
| Web Crypto API | HKDF-SHA256, AES-256-GCM, SHA-256 |
| Argon2 (WASM) | Password KDF (m=64MiB, t=3, p=1) |
| TweetNaCl | Ed25519 / X25519 cryptographic operations |
| cropper.esm.js | Image cropping (vendor) |
| qr-scanner.min.js | QR Code scanning (vendor) |
| qrcode-generator.js | QR Code generation (vendor) |

### Development Tools

| Tool | Purpose |
|------|---------|
| @playwright/test | E2E testing framework |
| wrangler | Cloudflare CLI (Workers/D1/Pages) |
| GitHub Actions | CI/CD (two-stage auto deployment) |

### Infrastructure

| Service | Purpose |
|---------|---------|
| Cloudflare Workers | Unified backend API + WebSocket (Durable Objects) |
| Cloudflare D1 | SQLite database |
| Cloudflare KV | Short-lived auth sessions + Presence storage |
| Cloudflare R2 | Media object storage |
| Cloudflare Pages | Frontend deployment (esbuild bundle + Pages Functions) |
| Cloudflare TURN | WebRTC call relay (dynamic credentials) |
| Cloudflare Durable Objects | Per-account stateful WebSocket management |

---

## License

AGPL-3.0-only

This project is licensed under AGPL-3.0, ensuring all derivative works remain open source so the community can continue to review and verify security.
