// ZXing-WASM 3.1.6 is loaded only when an uploaded image needs decoding.
self.onmessage = async ({ data: imageData }) => {
  try {
    importScripts('./reader.js');
    await ZXingWASM.prepareZXingModule({
      overrides: {
        locateFile: (path) => new URL(path, self.location.href).href,
        print: () => {},
        printErr: () => {}
      },
      fireImmediately: true
    });
  } catch {
    self.postMessage({ error: 'QR_ENGINE_FAILED' });
    return;
  }

  try {
    const results = await ZXingWASM.readBarcodes(imageData, {
      formats: ['QRCode'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      maxNumberOfSymbols: 2,
      textMode: 'Plain'
    });
    if (results.length > 1) {
      self.postMessage({ error: 'QR_MULTIPLE_CODES' });
      return;
    }
    const token = results[0]?.text?.trim() || '';
    self.postMessage(token ? { token } : { error: 'QR_NOT_FOUND' });
  } catch {
    self.postMessage({ error: 'QR_DECODE_FAILED' });
  }
};
