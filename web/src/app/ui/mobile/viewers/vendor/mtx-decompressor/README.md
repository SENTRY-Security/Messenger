# mtx-decompressor

[![npm version](https://img.shields.io/npm/v/mtx-decompressor.svg)](https://www.npmjs.com/package/mtx-decompressor)
[![CI](https://github.com/ChristopherVR/mtx-decompressor/actions/workflows/ci.yml/badge.svg)](https://github.com/ChristopherVR/mtx-decompressor/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/mtx-decompressor.svg)](LICENSE)

A zero-dependency TypeScript library that decompresses **MicroType Express (MTX)** compressed font data found inside **EOT** (Embedded OpenType) containers, producing standard **TrueType (.ttf)** font binaries.

MTX is a font compression format developed by Monotype, used inside EOT containers commonly found in older web pages and embedded in Microsoft Office documents. This library extracts the compressed data and reconstructs a standard `.ttf` file usable with standard font APIs (e.g. the `FontFace` API). It has no dependencies and works in both the browser and Node.js.

<samp>**[▶️ Live demo](https://christophervr.github.io/mtx-decompressor/)** · **[📦 npm](https://www.npmjs.com/package/mtx-decompressor)**</samp>

---

## Demo

Try it right in your browser — drop in an `.eot` file, download the extracted `.ttf`, and preview text rendered in the decompressed font:

**https://christophervr.github.io/mtx-decompressor/**

## Install

```bash
npm install mtx-decompressor
```

## Quick start

```typescript
import { decompressMtx, decompressEotFont } from 'mtx-decompressor';

// Decompress MTX-compressed font data
const fontData: Uint8Array = /* extracted from EOT container */;
const ttfBytes = decompressMtx(fontData, { encrypted: false, compressed: true });
// => Uint8Array containing a valid TrueType font

// Convenience wrapper with explicit boolean parameters
const ttf = decompressEotFont(fontData, /* compressed */ true, /* encrypted */ false);

// XOR-obfuscated data
const decrypted = decompressMtx(encryptedData, { encrypted: true, compressed: true });
```

## API

### `decompressMtx(fontData, options?)`

Decompress an MTX-compressed font into a TrueType binary.

| Parameter            | Type                         | Description                                                                   |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| `fontData`           | `Uint8Array`                 | Raw font bytes (MTX-compressed, optionally encrypted)                         |
| `options.encrypted`  | `boolean` (default: `false`) | If `true`, XOR-decrypt with key `0x50` before decompression                   |
| `options.compressed` | `boolean` (default: `true`)  | If `false`, skip decompression and return the (possibly decrypted) data as-is |
| **Returns**          | `Uint8Array`                 | A valid TrueType (.ttf) font binary                                           |

### `decompressEotFont(fontData, compressed, encrypted)`

Convenience wrapper around `decompressMtx` taking explicit boolean parameters; returns a TrueType binary.

### `unpackMtx(data, size)`

Low-level: unpack an MTX blob into three LZCOMP-decompressed streams. Returns `{ streams: Uint8Array[], sizes: number[] }`.

The exported `SFNTContainer` and `SFNTTable` types describe the reconstructed font tables.

## How it works

The pipeline: optional XOR decryption → MTX header parsing (splits into three LZCOMP blocks) → LZCOMP decompression (sliding-window LZ with adaptive Huffman coding) → CTF parsing (reconstructs TrueType tables from the three Compact TrueType Font streams) → SFNT assembly (table directory, alignment, checksums).

## Provenance

A TypeScript port of the MTX decompression code from [libeot](https://github.com/umanwizard/libeot) by Brennan Vincent (MPL-2.0). The original C implementation is based on the [MicroType Express specification](http://www.w3.org/Submission/MTX/) submitted to the W3C by Monotype Imaging.

## License

[MPL-2.0](LICENSE). As a TypeScript port of the MPL-2.0-licensed libeot, this library inherits the Mozilla Public License 2.0 — modifications to the licensed files must remain open under the same terms.

