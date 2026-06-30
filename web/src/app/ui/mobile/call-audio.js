import { log } from '../../core/log.js';
import { nativePlaySound, nativeStopSound, nativeStopAllSounds } from '../../features/native-bridge.js';

const SOUND_SOURCES = {
  outgoing: '/assets/audio/call-out.mp3',
  incoming: '/assets/audio/call-in.mp3',
  accepted: '/assets/audio/accept.mp3',
  ended: '/assets/audio/end-call.mp3'
};

/** Bundled sound basename (incl. extension) the native shell plays for a key. */
function nativeFileFor(key) {
  const src = SOUND_SOURCES[key];
  return src ? src.split('/').pop() : null;
}

function createAudioElement(src, { loop = false } = {}) {
  if (typeof Audio === 'undefined') return null;
  try {
    const el = new Audio(src);
    el.loop = loop;
    el.preload = 'auto';
    el.playsInline = true;
    el.crossOrigin = 'anonymous';
    return el;
  } catch (err) {
    log({ callAudioInitError: err?.message || err, src });
    return null;
  }
}

function safePause(audio) {
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (err) {
    log({ callAudioPauseError: err?.message || err });
  }
}

export function createCallAudioManager() {
  if (typeof Audio === 'undefined') {
    const noop = () => {};
    return {
      playOutgoingLoop: noop,
      playIncomingLoop: noop,
      stopLoops: noop,
      playAcceptedTone: noop,
      playEndTone: noop,
      stopAll: noop,
      dispose: noop
    };
  }

  const players = new Map();
  let currentLoop = null;

  function ensurePlayer(key, { loop = false } = {}) {
    if (players.has(key)) return players.get(key);
    const src = SOUND_SOURCES[key];
    if (!src) return null;
    const audio = createAudioElement(src, { loop });
    if (!audio) return null;
    audio.loop = loop;
    players.set(key, audio);
    return audio;
  }

  function playLoop(key) {
    if (currentLoop === key) return;
    stopLoop();
    currentLoop = key;
    // Native app: play the ringtone via the shell's AVAudioPlayer (reliable when
    // backgrounded / screen-locked). Falls through to HTML Audio on the web.
    if (nativePlaySound(nativeFileFor(key), { loop: true })) return;
    const audio = ensurePlayer(key, { loop: true });
    if (!audio) { currentLoop = null; return; }
    audio.loop = true;
    try {
      audio.currentTime = 0;
      const maybePromise = audio.play();
      if (maybePromise?.catch) {
        maybePromise.catch((err) => {
          log({ callAudioPlayError: err?.message || err, key });
          if (currentLoop === key) {
            currentLoop = null;
          }
        });
      }
    } catch (err) {
      log({ callAudioPlayError: err?.message || err, key });
      currentLoop = null;
    }
  }

  function stopLoop() {
    if (!currentLoop) return;
    nativeStopSound(nativeFileFor(currentLoop));
    const audio = players.get(currentLoop);
    safePause(audio);
    currentLoop = null;
  }

  function playOnce(key) {
    // Native app: play the one-shot tone natively; fall through on the web.
    if (nativePlaySound(nativeFileFor(key), { loop: false })) return;
    const audio = ensurePlayer(key, { loop: false });
    if (!audio) return;
    audio.loop = false;
    try {
      audio.currentTime = 0;
      const maybePromise = audio.play();
      if (maybePromise?.catch) {
        maybePromise.catch((err) => log({ callAudioPlayError: err?.message || err, key }));
      }
    } catch (err) {
      log({ callAudioPlayError: err?.message || err, key });
    }
  }

  function stopAll() {
    stopLoop();
    nativeStopAllSounds();
    for (const audio of players.values()) {
      safePause(audio);
    }
  }

  function dispose() {
    stopAll();
    for (const audio of players.values()) {
      try {
        audio.src = '';
        audio.load();
      } catch {}
    }
    players.clear();
  }

  return {
    playOutgoingLoop() {
      playLoop('outgoing');
    },
    playIncomingLoop() {
      playLoop('incoming');
    },
    stopLoops() {
      stopLoop();
    },
    playAcceptedTone() {
      playOnce('accepted');
    },
    playEndTone() {
      playOnce('ended');
    },
    stopAll,
    dispose
  };
}
