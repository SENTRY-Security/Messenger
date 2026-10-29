const WORKER_URL = '/assets/libs/zxing-wasm-3.1.6/worker.js';
const MAX_CANVAS_PIXELS = 12_000_000;
const MAX_CANVAS_EDGE = 4096;
const DECODE_TIMEOUT_MS = 15_000;
const WORKER_ERRORS = new Set([
  'QR_ENGINE_FAILED', 'QR_MULTIPLE_CODES', 'QR_NOT_FOUND', 'QR_DECODE_FAILED'
]);

function qrImageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Decode one uploaded QR image locally without persisting the image or token. */
export function decodeQrImage(file) {
  return new Promise((resolve, reject) => {
    let worker = null;
    let canvas = null;
    let objectUrl = null;
    let settled = false;
    const image = new Image();
    const timeout = setTimeout(() => finish(null, 'QR_DECODE_TIMEOUT'), DECODE_TIMEOUT_MS);

    function finish(token, code) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
      if (code) reject(qrImageError(code));
      else resolve(token);
    }

    image.onerror = () => finish(null, 'QR_IMAGE_LOAD_FAILED');
    image.onload = () => {
      let imageData;
      try {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!width || !height) throw qrImageError('QR_IMAGE_LOAD_FAILED');
        // Keep the aspect ratio and stay below mobile canvas memory/size limits.
        const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(width, height),
          Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(width * scale));
        canvas.height = Math.max(1, Math.floor(height * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw qrImageError('QR_IMAGE_LOAD_FAILED');
        // Transparent black QR images need a white background before decoding.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        finish(null, 'QR_IMAGE_LOAD_FAILED');
        return;
      }

      try {
        worker = new Worker(WORKER_URL);
        worker.onmessage = ({ data }) => {
          if (typeof data?.token === 'string' && data.token.trim()) {
            finish(data.token.trim());
          } else {
            finish(null, WORKER_ERRORS.has(data?.error) ? data.error : 'QR_DECODE_FAILED');
          }
        };
        worker.onerror = (event) => {
          event.preventDefault();
          finish(null, 'QR_ENGINE_FAILED');
        };
        worker.onmessageerror = () => finish(null, 'QR_DECODE_FAILED');
        worker.postMessage(imageData, [imageData.data.buffer]);
      } catch {
        finish(null, 'QR_ENGINE_FAILED');
      }
    };

    try {
      objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
    } catch {
      finish(null, 'QR_IMAGE_LOAD_FAILED');
    }
  });
}
