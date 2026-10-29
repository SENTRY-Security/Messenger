ZXing-WASM 3.1.6 - reader-only distribution

Upstream: https://github.com/Sec-ant/zxing-wasm/tree/v3.1.6
Package: https://registry.npmjs.org/zxing-wasm/-/zxing-wasm-3.1.6.tgz
reader.js: unchanged from dist/iife/reader/index.js
zxing_reader.wasm: unchanged from dist/reader/zxing_reader.wasm
worker.js: SENTRY Messenger integration; not an upstream file.

The npm package exports these source identifiers:
ZXING_CPP_COMMIT: 2c3dcfeffa7878950a58c1703c86774a428b0c91
ZXING_WASM_SHA256: 5003fb4b88c4fbd1fd518a2fd8c8ad365c519e183a08c03a322dddfea3cea84e

Licenses:
- zxing-wasm JavaScript: MIT, see LICENSE.
- zxing-cpp: Apache-2.0, see LICENSE.zxing-cpp.
- src/cpp/ZXingWasm.cpp bindings: Apache-2.0, see LICENSE.ZXingWasm.cpp.
The reader-only build does not include the Zint barcode writer.
Upstream licensing inventory: https://github.com/Sec-ant/zxing-wasm/blob/v3.1.6/README.md#licenses
The zxing-cpp root at the pinned source commit has LICENSE and no NOTICE file.

Vendored artifact SHA-256:
ffd72d59d54082194f7c086b384dcd930bdeb0c5b39fbb13779694e69bb0d344  reader.js
5003fb4b88c4fbd1fd518a2fd8c8ad365c519e183a08c03a322dddfea3cea84e  zxing_reader.wasm
