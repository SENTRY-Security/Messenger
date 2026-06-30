// Native (iOS) WebRTC call bridge — mid-term migration P1 (web half).
//
// When the iOS shell enables the native call engine it injects
// `window.USE_NATIVE_CALLS = true`. In that mode the *media* (RTCPeerConnection,
// RTCAudioSession, DTLS-SRTP) runs natively (see ios/SentryMessenger/Calls/);
// the web keeps only signaling (account WebSocket), E2EE key authorization and
// the call state machine. This module is the thin glue that lets media-session.js
// hand SDP work to native instead of a WebView RTCPeerConnection.
//
// Flow (signaling unchanged — still call-offer / call-answer over the account WS):
//   outgoing: nativeCallStart        → native emits nativeCallLocalSDP(offer)
//   incoming: nativeCallReceiveOffer  → native emits nativeCallLocalSDP(answer)
//   caller:   nativeCallReceiveAnswer → native applies the remote answer
//   mute/end: nativeCallMute / nativeCallEnd
// native → web events: nativeCallLocalSDP {callId, sdp, type}, nativeCallState
//   {callId, state}. Both are consumed by media-session.js.
//
// ICE is non-trickle in native mode too: the native side waits for gathering and
// embeds every candidate in the SDP, so call-ice-candidate signals are unused.

import { isNativeApp, postNativeMessage, onNativeEvent } from '../native-bridge.js';

/**
 * True when the running build is the native iOS shell with the native call
 * engine enabled. Pure web (and the App Clip, which leaves the flag false)
 * keep the in-WebView RTCPeerConnection path.
 */
export function isNativeCallMode() {
  return typeof window !== 'undefined'
    && window.USE_NATIVE_CALLS === true
    && isNativeApp();
}

/** Outgoing: ask native to build the peer and produce an offer. */
export function nativeCallStart({ callId, iceServers, video }) {
  postNativeMessage('nativeCallStart', { callId, iceServers: iceServers || [], video: !!video });
}

/** Incoming: hand native the remote offer; it produces an answer. */
export function nativeCallReceiveOffer({ callId, sdp, iceServers, video }) {
  postNativeMessage('nativeCallReceiveOffer', { callId, sdp, iceServers: iceServers || [], video: !!video });
}

/** Caller: hand native the remote answer to finish negotiation. */
export function nativeCallReceiveAnswer({ callId, sdp }) {
  postNativeMessage('nativeCallReceiveAnswer', { callId, sdp });
}

/** Mute / unmute the native local audio track. */
export function nativeCallMute({ callId, muted }) {
  postNativeMessage('nativeCallMute', { callId, muted: !!muted });
}

/** Tear down the native peer connection for a call. */
export function nativeCallEnd({ callId }) {
  postNativeMessage('nativeCallEnd', { callId });
}

export { onNativeEvent };
