// Native (iOS CallKit) bridge for voice/video calls — P1.
//
// Mirrors the web call state machine into the native CallKit layer and relays
// the user's actions on the system call UI (answer / end / mute) back into the
// web call controller. No-op outside the iOS native shell.
//
// Outbound (JS → native, via NativeBridge actions):
//   callIncoming    { callId, kind, peerName }
//   callStarted     { callId, kind, peerName }   (outgoing)
//   callConnected   { callId }
//   callStateChanged{ callId, muted }
//   callEnded       { callId, reason }
//
// Inbound (native → JS, from CallKit, via onNativeEvent):
//   callAnswered     { callId }   user tapped Answer on the system UI
//   callEndedByUser  { callId }   user tapped End/Decline on the system UI
//   callMuteToggled  { callId, muted }
//   audioReady       { callId }   CallKit activated the audio session

import { isNativeApp, postNativeMessage, onNativeEvent } from './native-bridge.js';
import { subscribeCallEvent, CALL_EVENT } from './calls/events.js';
import { CALL_SESSION_STATUS, CALL_REQUEST_KIND } from './calls/state.js';
import { recoverCallMediaOnResume } from './calls/media-session.js';

let installed = false;

// Action handlers supplied by the UI (call-overlay) so native-driven actions run
// the exact same accept/reject/hangup/mute paths as the on-screen buttons.
const handlers = { answer: null, end: null, setMuted: null };

/** UI registers its handlers here. Each is optional. */
export function setNativeCallActionHandlers({ answer, end, setMuted } = {}) {
  if (typeof answer === 'function') handlers.answer = answer;
  if (typeof end === 'function') handlers.end = end;
  if (typeof setMuted === 'function') handlers.setMuted = setMuted;
}

// Track what we've already reported so each transition is sent to CallKit once.
let lastCallId = null;
let lastStatus = null;
let lastMuted = null;

function peerName(session) {
  return session?.peerDisplayName || session?.remoteDisplayName || 'SENTRY';
}

function mutedOf(session) {
  const v = session?.mediaState?.controls?.audioMuted;
  return typeof v === 'boolean' ? v : null;
}

function handleStateChange({ session } = {}) {
  if (!session) return;
  const { callId, status, direction } = session;

  // New call appeared → report incoming/outgoing to CallKit.
  if (callId && callId !== lastCallId &&
      (status === CALL_SESSION_STATUS.INCOMING || status === CALL_SESSION_STATUS.OUTGOING)) {
    lastCallId = callId;
    lastStatus = null;
    lastMuted = null;
    const kind = session.kind === CALL_REQUEST_KIND.VIDEO ? 'video' : 'voice';
    if (status === CALL_SESSION_STATUS.INCOMING || direction === 'incoming') {
      postNativeMessage('callIncoming', { callId, kind, peerName: peerName(session) });
    } else {
      postNativeMessage('callStarted', { callId, kind, peerName: peerName(session) });
    }
  }

  if (!lastCallId || callId !== lastCallId) return;

  // Status transitions.
  if (status !== lastStatus) {
    lastStatus = status;
    if (status === CALL_SESSION_STATUS.IN_CALL) {
      postNativeMessage('callConnected', { callId });
    } else if (status === CALL_SESSION_STATUS.ENDED || status === CALL_SESSION_STATUS.FAILED) {
      const reason = status === CALL_SESSION_STATUS.FAILED ? 'failed' : 'ended';
      postNativeMessage('callEnded', { callId, reason });
      lastCallId = null;
      lastStatus = null;
      lastMuted = null;
      return;
    }
  }

  // Mute changes (reflect web-side mute into the system UI).
  const muted = mutedOf(session);
  if (muted !== null && muted !== lastMuted) {
    lastMuted = muted;
    postNativeMessage('callStateChanged', { callId, muted });
  }
}

/** Install the bridge. Idempotent; no-op when not running in the native shell. */
export function initNativeCallBridge() {
  if (installed || !isNativeApp()) return;
  installed = true;

  subscribeCallEvent(CALL_EVENT.STATE, handleStateChange);

  onNativeEvent('callAnswered', ({ callId }) => handlers.answer?.(callId));
  onNativeEvent('callEndedByUser', ({ callId }) => handlers.end?.(callId));
  onNativeEvent('callMuteToggled', ({ muted }) => handlers.setMuted?.(!!muted));
  // CallKit activated the audio route. WebKit may have started the WebRTC audio
  // unit before the route was up (the answer action fires before didActivate),
  // so re-attempt remote playback now that the session is live — otherwise the
  // call can be silent on answer.
  onNativeEvent('audioReady', () => {
    try { recoverCallMediaOnResume(); } catch { /* ignore */ }
  });
}
