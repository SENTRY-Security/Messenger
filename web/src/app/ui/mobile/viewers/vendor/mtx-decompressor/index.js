/*! @license MPL-2.0. mtx-decompressor v1.4.2 (ChristopherVR), derived from libeot (Brennan T. Vincent). Corresponding source and license: /assets/licenses/mtx-decompressor-source.zip. */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/stream.ts
var Stream = class _Stream {
  // current bit position within the byte at `pos`
  constructor(buf, size) {
    __publicField(this, "buf");
    __publicField(this, "size");
    // how much data has been written or is valid
    __publicField(this, "reserved");
    // allocated capacity
    __publicField(this, "pos");
    // current byte position
    __publicField(this, "bitPos");
    if (buf) {
      this.buf = buf;
      this.size = size;
      this.reserved = buf.length;
    } else {
      this.buf = new Uint8Array(0);
      this.size = 0;
      this.reserved = 0;
    }
    this.pos = 0;
    this.bitPos = 0;
  }
  static fromExisting(buf, size, reserved) {
    const s = new _Stream(null, 0);
    s.buf = buf;
    s.size = size;
    s.reserved = reserved;
    return s;
  }
  reserve(n) {
    if (this.reserved >= n) {
      return;
    }
    const newBuf = new Uint8Array(n);
    newBuf.set(this.buf.subarray(0, this.size));
    this.buf = newBuf;
    this.reserved = n;
  }
  ensureWrite(n) {
    const needed = this.pos + n;
    if (needed > this.reserved) {
      this.reserve(Math.max(needed, this.reserved * 2 || 256));
    }
    if (needed > this.size) {
      this.size = needed;
    }
  }
  ensureRead(n) {
    if (this.pos + n > this.size) {
      throw new Error(
        `Stream: not enough data (need ${n} bytes at pos ${this.pos}, size ${this.size})`
      );
    }
  }
  // --- Seek ---
  seekAbsolute(pos) {
    if (pos > this.size) {
      throw new Error(`Stream: seek past end (${pos} > ${this.size})`);
    }
    this.pos = pos;
    this.bitPos = 0;
  }
  seekRelative(offset) {
    const newPos = this.pos + offset;
    if (newPos < 0) {
      throw new Error("Stream: negative seek");
    }
    if (newPos > this.size) {
      throw new Error("Stream: seek past end");
    }
    this.pos = newPos;
    this.bitPos = 0;
  }
  seekAbsoluteThroughReserve(pos) {
    if (pos > this.reserved) {
      this.reserve(pos);
    }
    if (pos > this.size) {
      this.size = pos;
    }
    this.pos = pos;
    this.bitPos = 0;
  }
  seekRelativeThroughReserve(offset) {
    this.seekAbsoluteThroughReserve(this.pos + offset);
  }
  // --- Read (Big-Endian) ---
  readU8() {
    this.ensureRead(1);
    return this.buf[this.pos++];
  }
  peekU8() {
    this.ensureRead(1);
    return this.buf[this.pos];
  }
  readU16() {
    this.ensureRead(2);
    const v = this.buf[this.pos] << 8 | this.buf[this.pos + 1];
    this.pos += 2;
    return v;
  }
  readU24() {
    this.ensureRead(3);
    const v = this.buf[this.pos] << 16 | this.buf[this.pos + 1] << 8 | this.buf[this.pos + 2];
    this.pos += 3;
    return v;
  }
  readU32() {
    this.ensureRead(4);
    const v = (this.buf[this.pos] << 24 | this.buf[this.pos + 1] << 16 | this.buf[this.pos + 2] << 8 | this.buf[this.pos + 3]) >>> 0;
    this.pos += 4;
    return v;
  }
  readS16() {
    const v = this.readU16();
    return v >= 32768 ? v - 65536 : v;
  }
  readS8() {
    const v = this.readU8();
    return v >= 128 ? v - 256 : v;
  }
  readChar() {
    return String.fromCharCode(this.readU8());
  }
  // --- Write (Big-Endian) ---
  writeU8(v) {
    this.ensureWrite(1);
    this.buf[this.pos++] = v & 255;
  }
  writeU16(v) {
    this.ensureWrite(2);
    this.buf[this.pos++] = v >> 8 & 255;
    this.buf[this.pos++] = v & 255;
  }
  writeU24(v) {
    this.ensureWrite(3);
    this.buf[this.pos++] = v >> 16 & 255;
    this.buf[this.pos++] = v >> 8 & 255;
    this.buf[this.pos++] = v & 255;
  }
  writeU32(v) {
    this.ensureWrite(4);
    this.buf[this.pos++] = v >>> 24 & 255;
    this.buf[this.pos++] = v >> 16 & 255;
    this.buf[this.pos++] = v >> 8 & 255;
    this.buf[this.pos++] = v & 255;
  }
  writeS16(v) {
    this.writeU16(v < 0 ? v + 65536 : v);
  }
  writeS8(v) {
    this.writeU8(v < 0 ? v + 256 : v);
  }
  // --- Bit-level reading (for triplet coordinate decoding) ---
  readNBits(n) {
    if (n === 0) {
      return 0;
    }
    let value = 0;
    let bitsRemaining = n;
    while (bitsRemaining > 0) {
      if (this.pos >= this.size && this.bitPos === 0) {
        throw new Error("Stream: not enough data for bit read");
      }
      const bitsAvailableInByte = 8 - this.bitPos;
      const bitsToRead = Math.min(bitsRemaining, bitsAvailableInByte);
      const shift = bitsAvailableInByte - bitsToRead;
      const mask = (1 << bitsToRead) - 1 << shift;
      value = value << bitsToRead | (this.buf[this.pos] & mask) >> shift;
      this.bitPos += bitsToRead;
      if (this.bitPos >= 8) {
        this.bitPos = 0;
        this.pos++;
      }
      bitsRemaining -= bitsToRead;
    }
    return value;
  }
  // --- Copy ---
  /** Copy `length` bytes from this stream to `dest`. */
  copyTo(dest, length) {
    if (this.pos + length > this.size) {
      throw new Error("Stream: not enough data for copy");
    }
    dest.ensureWrite(length);
    dest.buf.set(this.buf.subarray(this.pos, this.pos + length), dest.pos);
    this.pos += length;
    dest.pos += length;
  }
  /** Read rest of data as 4-byte-aligned U32 values. Returns 0 on incomplete read. */
  readRestAsU32() {
    if (this.pos + 4 > this.size) {
      if (this.pos >= this.size) {
        return null;
      }
      let val = 0;
      const remaining = this.size - this.pos;
      for (let i = 0; i < 4; i++) {
        val <<= 8;
        if (i < remaining) {
          val |= this.buf[this.pos + i];
        }
      }
      this.pos = this.size;
      return val >>> 0;
    }
    return this.readU32();
  }
  /** Compute checksum of bytes from beginPos to endPos as 4-byte aligned U32 sum. */
  checksumU32(beginPos, endPos) {
    let sum = 0;
    const savedPos = this.pos;
    this.pos = beginPos;
    while (this.pos < endPos) {
      const chunk = this.readRestAsU32();
      if (chunk === null) {
        break;
      }
      sum = sum + chunk >>> 0;
    }
    this.pos = savedPos;
    return sum;
  }
  /** Get a copy of the written data. */
  toUint8Array() {
    return this.buf.slice(0, this.size);
  }
};

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/triplet-encodings.ts
var TRIPLET_ENCODINGS = [
  // Indices 0-9: xBits=0 or yBits=0 (one axis)
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 0, xSign: 0, ySign: -1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 0, xSign: 0, ySign: 1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 256, xSign: 0, ySign: -1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 256, xSign: 0, ySign: 1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 512, xSign: 0, ySign: -1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 512, xSign: 0, ySign: 1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 768, xSign: 0, ySign: -1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 768, xSign: 0, ySign: 1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 1024, xSign: 0, ySign: -1 },
  { byteCount: 2, xBits: 0, yBits: 8, deltaX: 0, deltaY: 1024, xSign: 0, ySign: 1 },
  // Indices 10-19: yBits=0 (X axis only)
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 0, deltaY: 0, xSign: -1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 0, deltaY: 0, xSign: 1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 256, deltaY: 0, xSign: -1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 256, deltaY: 0, xSign: 1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 512, deltaY: 0, xSign: -1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 512, deltaY: 0, xSign: 1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 768, deltaY: 0, xSign: -1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 768, deltaY: 0, xSign: 1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 1024, deltaY: 0, xSign: -1, ySign: 0 },
  { byteCount: 2, xBits: 8, yBits: 0, deltaX: 1024, deltaY: 0, xSign: 1, ySign: 0 },
  // Indices 20-83: 4-bit X + 4-bit Y (2 bytes total)
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 17, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 17, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 17, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 17, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 33, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 33, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 33, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 33, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 49, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 49, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 49, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 1, deltaY: 49, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 17, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 17, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 17, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 17, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 33, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 33, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 33, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 33, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 49, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 49, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 49, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 17, deltaY: 49, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 17, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 17, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 17, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 17, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 33, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 33, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 33, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 33, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 49, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 49, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 49, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 33, deltaY: 49, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 17, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 17, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 17, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 17, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 33, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 33, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 33, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 33, xSign: 1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 49, xSign: -1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 49, xSign: 1, ySign: -1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 49, xSign: -1, ySign: 1 },
  { byteCount: 2, xBits: 4, yBits: 4, deltaX: 49, deltaY: 49, xSign: 1, ySign: 1 },
  // Indices 84-119: 8-bit X + 8-bit Y (3 bytes total)
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 257, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 257, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 257, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 257, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 513, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 513, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 513, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 1, deltaY: 513, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 257, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 257, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 257, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 257, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 513, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 513, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 513, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 257, deltaY: 513, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 1, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 1, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 1, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 1, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 257, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 257, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 257, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 257, xSign: 1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 513, xSign: -1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 513, xSign: 1, ySign: -1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 513, xSign: -1, ySign: 1 },
  { byteCount: 3, xBits: 8, yBits: 8, deltaX: 513, deltaY: 513, xSign: 1, ySign: 1 },
  // Indices 120-123: 12-bit X + 12-bit Y (4 bytes total)
  { byteCount: 4, xBits: 12, yBits: 12, deltaX: 0, deltaY: 0, xSign: -1, ySign: -1 },
  { byteCount: 4, xBits: 12, yBits: 12, deltaX: 0, deltaY: 0, xSign: 1, ySign: -1 },
  { byteCount: 4, xBits: 12, yBits: 12, deltaX: 0, deltaY: 0, xSign: -1, ySign: 1 },
  { byteCount: 4, xBits: 12, yBits: 12, deltaX: 0, deltaY: 0, xSign: 1, ySign: 1 },
  // Indices 124-127: 16-bit X + 16-bit Y (5 bytes total)
  { byteCount: 5, xBits: 16, yBits: 16, deltaX: 0, deltaY: 0, xSign: -1, ySign: -1 },
  { byteCount: 5, xBits: 16, yBits: 16, deltaX: 0, deltaY: 0, xSign: 1, ySign: -1 },
  { byteCount: 5, xBits: 16, yBits: 16, deltaX: 0, deltaY: 0, xSign: -1, ySign: 1 },
  { byteCount: 5, xBits: 16, yBits: 16, deltaX: 0, deltaY: 0, xSign: 1, ySign: 1 }
];

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/ctf-parser.ts
var FLG_ON_CURVE = 1;
var FLG_X_SHORT = 2;
var FLG_Y_SHORT = 4;
var FLG_X_SAME = 16;
var FLG_Y_SAME = 32;
var NPUSHB = 64;
var NPUSHW = 65;
var PUSHB = 176;
var PUSHW = 184;
var ARG_1_AND_2_ARE_WORDS = 1;
var HAVE_SCALE = 8;
var MORE_COMPONENTS = 32;
var HAVE_XY_SCALE = 64;
var HAVE_2_BY_2 = 128;
var HAVE_INSTRUCTIONS = 256;
var INT16_MIN = -32768;
var INT16_MAX = 32767;
function toInt16(v) {
  v &= 65535;
  return v >= 32768 ? v - 65536 : v;
}
function read255UShort(s) {
  const code = s.readU8();
  if (code === 253) {
    return s.readU16();
  }
  if (code === 255) {
    return 253 + s.readU8();
  }
  if (code === 254) {
    return 506 + s.readU8();
  }
  return code;
}
function read255Short(s) {
  let sign = 1;
  let code = s.readU8();
  if (code === 253) {
    return s.readS16();
  }
  if (code === 250) {
    sign = -1;
    code = s.readU8();
  }
  let value;
  if (code === 255) {
    value = 250 + s.readU8();
  } else if (code === 254) {
    value = 500 + s.readU8();
  } else {
    value = code;
  }
  return value * sign;
}
function unpackCVT(table, sIn) {
  sIn.seekAbsolute(table.offset);
  const tableLength = sIn.readU16();
  const numEntries = tableLength >>> 1;
  const out = new Stream(null, 0);
  out.reserve(tableLength);
  let lastValue = 0;
  for (let i = 0; i < numEntries; i++) {
    const code = sIn.readU8();
    let val;
    if (code >= 248) {
      val = 238 * (code - 247) + sIn.readU8();
    } else if (code >= 239) {
      val = -(238 * (code - 239) + sIn.readU8());
    } else if (code === 238) {
      val = sIn.readS16();
    } else {
      val = code;
    }
    lastValue = toInt16(lastValue + val);
    out.writeS16(lastValue);
  }
  table.buf = out.toUint8Array();
  table.bufSize = table.buf.length;
}
function decodePushInstructions(sIn, sOut, pushCount) {
  if (pushCount === 0) {
    return;
  }
  const data = [];
  let remaining = pushCount;
  let isShort = false;
  const runValues = [];
  function flush() {
    if (runValues.length === 0) {
      return;
    }
    const count = runValues.length;
    if (isShort) {
      if (count < 8) {
        sOut.writeU8(PUSHW + (count - 1));
      } else {
        sOut.writeU8(NPUSHW);
        sOut.writeU8(count);
      }
      for (const v of runValues) {
        sOut.writeS16(v);
      }
    } else {
      if (count < 8) {
        sOut.writeU8(PUSHB + (count - 1));
      } else {
        sOut.writeU8(NPUSHB);
        sOut.writeU8(count);
      }
      for (const v of runValues) {
        sOut.writeU8(v & 255);
      }
    }
    runValues.length = 0;
  }
  function put(v) {
    data.push(v);
    const needsShort = v < 0 || v > 255;
    if (runValues.length > 0 && needsShort !== isShort) {
      flush();
    }
    if (runValues.length === 0) {
      isShort = needsShort;
    }
    runValues.push(v);
    if (runValues.length >= 255) {
      flush();
    }
  }
  while (remaining > 0) {
    const code = sIn.peekU8();
    if (code === 251 && remaining >= 3 && data.length >= 2) {
      sIn.readU8();
      const prev = data[data.length - 2];
      put(prev);
      const val = read255Short(sIn);
      put(val);
      put(prev);
      remaining -= 3;
    } else if (code === 252 && remaining >= 5 && data.length >= 2) {
      sIn.readU8();
      const prev = data[data.length - 2];
      put(prev);
      const c = read255Short(sIn);
      put(c);
      put(prev);
      const d = read255Short(sIn);
      put(d);
      put(prev);
      remaining -= 5;
    } else {
      const v = read255Short(sIn);
      put(v);
      remaining -= 1;
    }
  }
  flush();
}
function makeGlyphFlags(x, y, onCurve, firstTime) {
  let flags = 0;
  if (onCurve) {
    flags |= FLG_ON_CURVE;
  }
  if (!firstTime && x === 0) {
    flags |= FLG_X_SAME;
  } else if (x > -256 && x < 0) {
    flags |= FLG_X_SHORT;
  } else if (x >= 0 && x < 256) {
    flags |= FLG_X_SHORT | FLG_X_SAME;
  }
  if (!firstTime && y === 0) {
    flags |= FLG_Y_SAME;
  } else if (y > -256 && y < 0) {
    flags |= FLG_Y_SHORT;
  } else if (y >= 0 && y < 256) {
    flags |= FLG_Y_SHORT | FLG_Y_SAME;
  }
  return flags;
}
function decodeSimpleGlyph(numContours, streams, out, calcBBox, minX, minY, maxX, maxY) {
  if (numContours === 0) {
    return;
  }
  const sGlyph = streams[0];
  out.writeS16(numContours);
  const bboxPos = out.pos;
  if (calcBBox) {
    minX = INT16_MAX;
    minY = INT16_MAX;
    maxX = INT16_MIN;
    maxY = INT16_MIN;
    out.writeS16(0);
    out.writeS16(0);
    out.writeS16(0);
    out.writeS16(0);
  } else {
    out.writeS16(minX);
    out.writeS16(minY);
    out.writeS16(maxX);
    out.writeS16(maxY);
  }
  let totalPoints = 0;
  for (let c = 0; c < numContours; c++) {
    if (c === 0) {
      totalPoints = 1;
    }
    const pointsInContour = read255UShort(sGlyph);
    totalPoints += pointsInContour;
    out.writeU16(totalPoints - 1);
  }
  const flagBytes = new Uint8Array(totalPoints);
  for (let i = 0; i < totalPoints; i++) {
    flagBytes[i] = sGlyph.readU8();
  }
  const xDeltas = new Int16Array(totalPoints);
  const yDeltas = new Int16Array(totalPoints);
  const onCurve = new Uint8Array(totalPoints);
  let cumulativeX = 0;
  let cumulativeY = 0;
  for (let i = 0; i < totalPoints; i++) {
    const flag = flagBytes[i];
    onCurve[i] = flag & 128 ? 0 : 1;
    const enc = TRIPLET_ENCODINGS[flag & 127];
    let dx = sGlyph.readNBits(enc.xBits) + enc.deltaX;
    let dy = sGlyph.readNBits(enc.yBits) + enc.deltaY;
    if (enc.xSign !== 0) {
      dx *= enc.xSign;
    }
    if (enc.ySign !== 0) {
      dy *= enc.ySign;
    }
    xDeltas[i] = dx;
    yDeltas[i] = dy;
    cumulativeX += dx;
    cumulativeY += dy;
    if (calcBBox) {
      if (cumulativeX < minX) {
        minX = cumulativeX;
      }
      if (cumulativeX > maxX) {
        maxX = cumulativeX;
      }
      if (cumulativeY < minY) {
        minY = cumulativeY;
      }
      if (cumulativeY > maxY) {
        maxY = cumulativeY;
      }
    }
  }
  const codeSizeLocation = out.pos;
  out.writeU16(0);
  const pushCount = read255UShort(sGlyph);
  decodePushInstructions(streams[1], out, pushCount);
  const codeSize = read255UShort(sGlyph);
  if (codeSize > 0) {
    streams[2].copyTo(out, codeSize);
  }
  const unpackedCodeSize = out.pos - (codeSizeLocation + 2);
  const savedPos = out.pos;
  out.seekAbsolute(codeSizeLocation);
  out.writeU16(unpackedCodeSize);
  out.seekAbsolute(savedPos);
  for (let i = 0; i < totalPoints; i++) {
    const f = makeGlyphFlags(xDeltas[i], yDeltas[i], onCurve[i] !== 0, i === 0);
    out.writeU8(f);
  }
  for (let i = 0; i < totalPoints; i++) {
    const x = xDeltas[i];
    if (i === 0 || x !== 0) {
      const absX = Math.abs(x);
      if (absX < 256) {
        out.writeU8(absX);
      } else {
        out.writeS16(x);
      }
    }
  }
  for (let i = 0; i < totalPoints; i++) {
    const y = yDeltas[i];
    if (i === 0 || y !== 0) {
      const absY = Math.abs(y);
      if (absY < 256) {
        out.writeU8(absY);
      } else {
        out.writeS16(y);
      }
    }
  }
  if (calcBBox) {
    const endPos = out.pos;
    out.seekAbsolute(bboxPos);
    out.writeS16(minX);
    out.writeS16(minY);
    out.writeS16(maxX);
    out.writeS16(maxY);
    out.seekAbsolute(endPos);
  }
}
function decodeCompositeGlyph(streams, out) {
  const sGlyph = streams[0];
  out.writeS16(-1);
  out.writeS16(sGlyph.readS16());
  out.writeS16(sGlyph.readS16());
  out.writeS16(sGlyph.readS16());
  out.writeS16(sGlyph.readS16());
  let flags = 0;
  do {
    flags = sGlyph.readU16();
    const glyphIndex = sGlyph.readU16();
    out.writeU16(flags);
    out.writeU16(glyphIndex);
    let argBytes;
    if (flags & ARG_1_AND_2_ARE_WORDS) {
      argBytes = 4;
    } else {
      argBytes = 2;
    }
    sGlyph.copyTo(out, argBytes);
    let transformBytes = 0;
    if (flags & HAVE_2_BY_2) {
      transformBytes = 8;
    } else if (flags & HAVE_XY_SCALE) {
      transformBytes = 4;
    } else if (flags & HAVE_SCALE) {
      transformBytes = 2;
    }
    if (transformBytes > 0) {
      sGlyph.copyTo(out, transformBytes);
    }
  } while (flags & MORE_COMPONENTS);
  if (flags & HAVE_INSTRUCTIONS) {
    const numInstrPos = out.pos;
    out.writeU16(0);
    const pushCount = read255UShort(sGlyph);
    decodePushInstructions(streams[1], out, pushCount);
    const codeSize = read255UShort(sGlyph);
    if (codeSize > 0) {
      streams[2].copyTo(out, codeSize);
    }
    const numInstr = out.pos - (numInstrPos + 2);
    const savedPos = out.pos;
    out.seekAbsolute(numInstrPos);
    out.writeU16(numInstr);
    out.seekAbsolute(savedPos);
  }
}
function decodeGlyph(streams, out) {
  const numContours = streams[0].readS16();
  if (numContours < 0) {
    decodeCompositeGlyph(streams, out);
  } else if (numContours === 32767) {
    const actualContours = streams[0].readS16();
    const xMin = streams[0].readS16();
    const yMin = streams[0].readS16();
    const xMax = streams[0].readS16();
    const yMax = streams[0].readS16();
    decodeSimpleGlyph(actualContours, streams, out, false, xMin, yMin, xMax, yMax);
  } else {
    decodeSimpleGlyph(numContours, streams, out, true, 0, 0, 0, 0);
  }
}
function populateGlyfAndLoca(glyf, loca, headData, maxpData, streams) {
  const numGlyphs = maxpData.numGlyphs;
  streams[0].seekAbsolute(glyf.offset);
  streams[1].seekAbsolute(0);
  streams[2].seekAbsolute(0);
  const maxGlyphSize = 5 * 2 + // header (numContours + bbox)
  2 * maxpData.maxContours + // endPtsOfContours
  2 + // instructionLength
  maxpData.maxSizeOfInstructions + 256 + // instructions + padding
  5 * maxpData.maxPoints + // flags + coordinates
  4 * maxpData.maxComponentElements * 6 + // composite components
  256;
  const outStream = new Stream(null, 0);
  outStream.reserve(numGlyphs * 256);
  const isShortLoca = headData.indexToLocFormat === 0;
  const locaEntrySize = isShortLoca ? 2 : 4;
  const locaStream = new Stream(null, 0);
  locaStream.reserve((numGlyphs + 1) * locaEntrySize);
  if (isShortLoca) {
    locaStream.writeU16(0);
  } else {
    locaStream.writeU32(0);
  }
  for (let i = 0; i < numGlyphs; i++) {
    const _glyphStart = outStream.pos;
    outStream.reserve(outStream.pos + maxGlyphSize);
    decodeGlyph(streams, outStream);
    if (outStream.pos & 1) {
      outStream.writeU8(0);
    }
    if (isShortLoca) {
      locaStream.writeU16(outStream.pos >>> 1);
    } else {
      locaStream.writeU32(outStream.pos);
    }
  }
  glyf.buf = outStream.toUint8Array();
  glyf.bufSize = glyf.buf.length;
  loca.buf = locaStream.toUint8Array();
  loca.bufSize = loca.buf.length;
}
function parseHead(table) {
  const s = new Stream(table.buf, table.bufSize);
  s.seekAbsolute(50);
  return { indexToLocFormat: s.readS16() };
}
function parseMaxp(table) {
  const s = new Stream(table.buf, table.bufSize);
  const version = s.readU32();
  const numGlyphs = s.readU16();
  let maxPoints = 0;
  let maxContours = 0;
  let maxSizeOfInstructions = 0;
  let maxComponentElements = 0;
  if (version === 65536) {
    maxPoints = s.readU16();
    maxContours = s.readU16();
    s.readU16();
    s.readU16();
    s.readU16();
    s.readU16();
    s.readU16();
    s.readU16();
    s.readU16();
    s.readU16();
    maxSizeOfInstructions = s.readU16();
    maxComponentElements = s.readU16();
  }
  return {
    numGlyphs,
    maxPoints,
    maxContours,
    maxSizeOfInstructions,
    maxComponentElements
  };
}
function parseCTF(streams) {
  const s0 = streams[0];
  const _scalarType = s0.readU32();
  const numTables = s0.readU16();
  const _searchRange = s0.readU16();
  const _entrySelector = s0.readU16();
  const _rangeShift = s0.readU16();
  const tables = [];
  let glyfIdx = -1;
  let locaIdx = -1;
  let maxpIdx = -1;
  let headIdx = -1;
  let _hmtxIdx = -1;
  let _cvtIdx = -1;
  for (let i = 0; i < numTables; i++) {
    const tag = s0.readChar() + s0.readChar() + s0.readChar() + s0.readChar();
    if (tag === "hdmx" || tag === "VDMX") {
      s0.seekRelative(12);
      continue;
    }
    s0.seekRelative(4);
    const offset = s0.readU32();
    const size = s0.readU32();
    const table = {
      tag,
      offset,
      bufSize: size,
      buf: new Uint8Array(0),
      checksum: 0
    };
    const idx = tables.length;
    tables.push(table);
    if (tag === "glyf") {
      glyfIdx = idx;
    } else if (tag === "loca") {
      locaIdx = idx;
    } else if (tag === "maxp") {
      maxpIdx = idx;
    } else if (tag === "head") {
      headIdx = idx;
    } else if (tag === "hmtx") {
      _hmtxIdx = idx;
    } else if (tag === "cvt ") {
      _cvtIdx = idx;
    }
  }
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    if (table.tag === "glyf" || table.tag === "loca") {
      continue;
    }
    if (table.tag === "cvt ") {
      unpackCVT(table, s0);
      continue;
    }
    s0.seekAbsolute(table.offset);
    const buf = new Uint8Array(table.bufSize);
    for (let b = 0; b < table.bufSize; b++) {
      buf[b] = s0.readU8();
    }
    table.buf = buf;
    if (table.tag === "head") {
      table.buf[8] = 0;
      table.buf[9] = 0;
      table.buf[10] = 0;
      table.buf[11] = 0;
    }
  }
  let headData = { indexToLocFormat: 0 };
  if (headIdx >= 0) {
    headData = parseHead(tables[headIdx]);
  }
  let maxpData = {
    numGlyphs: 0,
    maxPoints: 0,
    maxContours: 0,
    maxSizeOfInstructions: 0,
    maxComponentElements: 0
  };
  if (maxpIdx >= 0) {
    maxpData = parseMaxp(tables[maxpIdx]);
  }
  if (glyfIdx >= 0) {
    if (locaIdx < 0) {
      const locaTable = {
        tag: "loca",
        offset: 0,
        bufSize: 0,
        buf: new Uint8Array(0),
        checksum: 0
      };
      locaIdx = tables.length;
      tables.push(locaTable);
    }
    populateGlyfAndLoca(tables[glyfIdx], tables[locaIdx], headData, maxpData, streams);
  }
  return { tables };
}

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/ahuff.ts
function bitsUsed(x) {
  if (x <= 0) {
    return 0;
  }
  return 32 - Math.clz32(x);
}
var _AHuff = class _AHuff {
  constructor(bio, range) {
    __publicField(this, "bio");
    __publicField(this, "range");
    __publicField(this, "tree");
    /** Maps symbol value -> current tree index of its leaf node. */
    __publicField(this, "symbolIndex");
    /** Number of bits that encode a "full-size" symbol (ceil(log2(range))). */
    __publicField(this, "bitCount");
    /**
     * Secondary bit width used for large-range trees.
     * 0 when range <= 256 (small tree path).
     */
    __publicField(this, "bitCount2");
    this.bio = bio;
    this.range = range;
    this.bitCount = bitsUsed(range - 1);
    this.bitCount2 = 0;
    if (range > 256 && range < 512) {
      this.bitCount2 = bitsUsed(range - 256 - 1) + 1;
    }
    const treeSize = 2 * range;
    this.tree = Array.from({ length: treeSize });
    for (let i = 0; i < treeSize; i++) {
      this.tree[i] = { up: 0, left: 0, right: 0, code: -1, weight: 0 };
    }
    for (let i = 2; i < treeSize; i++) {
      this.tree[i].up = i >> 1;
      this.tree[i].weight = 1;
    }
    for (let i = 1; i < range; i++) {
      this.tree[i].left = 2 * i;
      this.tree[i].right = 2 * i + 1;
      this.tree[i].code = -1;
    }
    for (let i = 0; i < range; i++) {
      const leafIdx = range + i;
      this.tree[leafIdx].code = i;
      this.tree[leafIdx].left = -1;
      this.tree[leafIdx].right = -1;
    }
    this.symbolIndex = Array.from({ length: range });
    for (let i = 0; i < range; i++) {
      this.symbolIndex[i] = range + i;
    }
    this.initWeight(_AHuff.ROOT);
    if (this.bitCount2 !== 0) {
      this.updateWeight(this.symbolIndex[256]);
      this.updateWeight(this.symbolIndex[257]);
      const dup2Sym = range - 3;
      for (let i = 0; i < 12; i++) {
        this.updateWeight(this.symbolIndex[dup2Sym]);
      }
      const dup4Sym = range - 2;
      for (let i = 0; i < 6; i++) {
        this.updateWeight(this.symbolIndex[dup4Sym]);
      }
    } else {
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < range; i++) {
          this.updateWeight(this.symbolIndex[i]);
        }
      }
    }
  }
  // --------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------
  /**
   * Decode one symbol from the bit stream.
   *
   * Starting at ROOT, read one bit at a time:
   *   - 0 → go left
   *   - 1 → go right
   * Continue until a leaf (code >= 0) is reached.  Then update the
   * tree weights and return the symbol code.
   */
  readSymbol() {
    let a = _AHuff.ROOT;
    let symbol;
    do {
      a = this.bio.inputBit() ? this.tree[a].right : this.tree[a].left;
      symbol = this.tree[a].code;
    } while (symbol < 0);
    this.updateWeight(a);
    return symbol;
  }
  // --------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------
  /**
   * Increment the weight of node `a` and propagate up to ROOT,
   * swapping nodes as necessary to maintain the sibling property
   * (nodes in non-increasing weight order by index).
   *
   * Algorithm:
   *   For each node from `a` up to (but not including) ROOT:
   *     1. Look at the predecessor (a-1).
   *     2. If it has the same weight, scan backwards to find the first
   *        node with that weight.
   *     3. Swap `a` with that first node (unless it is ROOT or `a`'s
   *        own parent) to restore ordering.
   *     4. Increment `a`'s weight.
   *     5. Move to `a`'s parent.
   *   Finally increment ROOT's weight.
   */
  updateWeight(a) {
    const tree = this.tree;
    for (; a !== _AHuff.ROOT; a = tree[a].up) {
      const weightA = tree[a].weight;
      let b = a - 1;
      if (tree[b].weight === weightA) {
        do {
          b--;
        } while (tree[b].weight === weightA);
        b++;
        if (b > _AHuff.ROOT) {
          this.swapNodes(a, b);
          a = b;
        }
      }
      tree[a].weight = weightA + 1;
    }
    tree[_AHuff.ROOT].weight++;
  }
  /**
   * Swap two nodes in the tree while keeping the parent linkage
   * consistent.
   *
   * What gets swapped: left, right, code, weight — everything that
   * defines the *content* of the node.  The `up` pointer stays with
   * the position (the parent still points here).
   *
   * After the content swap we must:
   *   1. Fix children's `up` pointers (they now live under the other
   *      position).
   *   2. Fix `symbolIndex` for leaves so we can still find them by
   *      symbol value.
   */
  swapNodes(a, b) {
    const tree = this.tree;
    const upa = tree[a].up;
    const upb = tree[b].up;
    const tmp = tree[a];
    tree[a] = tree[b];
    tree[b] = tmp;
    tree[a].up = upa;
    tree[b].up = upb;
    let code = tree[a].code;
    if (code < 0) {
      tree[tree[a].left].up = a;
      tree[tree[a].right].up = a;
    } else {
      this.symbolIndex[code] = a;
    }
    code = tree[b].code;
    if (code < 0) {
      tree[tree[b].left].up = b;
      tree[tree[b].right].up = b;
    } else {
      this.symbolIndex[code] = b;
    }
  }
  /**
   * Recursively compute weights for internal nodes after the initial
   * tree construction.  Leaf weights are already set to 1.
   *
   * weight(internal) = weight(left) + weight(right)
   */
  initWeight(a) {
    const node = this.tree[a];
    if (node.code >= 0) {
      return node.weight;
    }
    node.weight = this.initWeight(node.left) + this.initWeight(node.right);
    return node.weight;
  }
};
__publicField(_AHuff, "ROOT", 1);
var AHuff = _AHuff;

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/bitio.ts
var BitIO = class {
  /**
   * @param data   Source byte buffer.
   * @param offset Starting byte offset into `data`.
   * @param size   Number of bytes available from `offset`.
   */
  constructor(data, offset = 0, size) {
    __publicField(this, "data");
    __publicField(this, "index");
    __publicField(this, "size");
    __publicField(this, "bitBuffer", 0);
    __publicField(this, "bitCount", 0);
    this.data = data;
    this.index = offset;
    this.size = size ?? data.length;
  }
  /**
   * Read a single bit from the stream.
   *
   * Mirrors `MTX_BITIO_input_bit`:
   *   - If `bitCount` has reached 0, load the next byte into `bitBuffer`
   *     and reset `bitCount` to 7.
   *   - Shift `bitBuffer` left by 1.
   *   - Return whether bit 8 (0x100) is set (i.e. the MSB that was
   *     shifted out of the original byte value).
   */
  inputBit() {
    if (this.bitCount-- === 0) {
      if (this.index >= this.size) {
        throw new Error("BitIO: end of data");
      }
      this.bitBuffer = this.data[this.index++];
      this.bitCount = 7;
    }
    this.bitBuffer <<= 1;
    return (this.bitBuffer & 256) !== 0;
  }
  /**
   * Read an unsigned integer of `numberOfBits` width, MSB first.
   *
   * Mirrors `MTX_BITIO_ReadValue`: accumulates bits from the most
   * significant down to the least significant.
   */
  readValue(numberOfBits) {
    let value = 0;
    for (let i = numberOfBits - 1; i >= 0; i--) {
      value <<= 1;
      if (this.inputBit()) {
        value |= 1;
      }
    }
    return value;
  }
};

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/lzcomp.ts
var LEN_WIDTH = 3;
var DIST_WIDTH = 3;
var BIT_RANGE = LEN_WIDTH - 1;
var MAX_2BYTE_DIST = 512;
var PRELOAD_SIZE = 2 * 32 * 96 + 4 * 256;
var LEN_MIN = 2;
var DIST_MIN = 1;
var MAX_OUT_LEN = 4 * 1024 * 1024;
var MAX_OUT = 16 * 1024 * 1024;
var RLE_INITIAL = 0;
var RLE_NORMAL = 1;
var RLE_SEEN_ESCAPE = 2;
var RLE_NEED_BYTE = 3;
function setDistRange(length) {
  let numDistRanges = 1;
  let distMax = DIST_MIN + ((1 << DIST_WIDTH * numDistRanges) - 1);
  while (distMax < length) {
    numDistRanges++;
    if (numDistRanges > 8) {
      throw new Error("LZCOMP setDistRange: numDistRanges exceeds bound (8)");
    }
    distMax = DIST_MIN + ((1 << DIST_WIDTH * numDistRanges) - 1);
  }
  const DUP2 = 256 + (1 << LEN_WIDTH) * numDistRanges;
  const DUP4 = DUP2 + 1;
  const DUP6 = DUP4 + 1;
  const NUM_SYMS = DUP6 + 1;
  return { numDistRanges, distMax, DUP2, DUP4, DUP6, NUM_SYMS };
}
function initializeModel(window) {
  let i = 0;
  for (let k = 0; k < 32; k++) {
    for (let j2 = 0; j2 < 96; j2++) {
      window[i++] = k;
      window[i++] = j2;
    }
  }
  let j = 0;
  while (i < PRELOAD_SIZE && j < 256) {
    window[i++] = j;
    window[i++] = j;
    window[i++] = j;
    window[i++] = j;
    j++;
  }
}
function decodeLength(lenEcoder, symbol, numDistRangesOut) {
  const mask = 1 << BIT_RANGE;
  let firstTime = true;
  let value = 0;
  let done;
  let iters = 0;
  do {
    if (++iters > 16) {
      throw new Error("LZCOMP decodeLength: iteration cap exceeded");
    }
    let bits;
    if (firstTime) {
      bits = symbol - 256;
      firstTime = false;
      numDistRangesOut[0] = Math.floor(bits / (1 << LEN_WIDTH)) + 1;
      bits %= 1 << LEN_WIDTH;
    } else {
      bits = lenEcoder.readSymbol();
    }
    done = (bits & mask) === 0;
    bits &= ~mask;
    value <<= BIT_RANGE;
    value |= bits;
  } while (!done);
  value += LEN_MIN;
  return value;
}
function decodeDistance(distEcoder, numDistRanges) {
  let value = 0;
  for (let i = numDistRanges; i > 0; i--) {
    const bits = distEcoder.readSymbol();
    value <<= DIST_WIDTH;
    value |= bits;
  }
  value += DIST_MIN;
  return value;
}
function lzcompDecompress(data, size, version) {
  const bio = new BitIO(data, 0, size);
  let usingRunLength;
  if (version === 1) {
    usingRunLength = false;
  } else {
    usingRunLength = bio.inputBit();
  }
  const distEcoder = new AHuff(bio, 1 << DIST_WIDTH);
  const lenEcoder = new AHuff(bio, 1 << LEN_WIDTH);
  const outLen = bio.readValue(24);
  if (outLen > MAX_OUT_LEN) {
    throw new Error(`LZCOMP outLen ${outLen} exceeds maximum (${MAX_OUT_LEN})`);
  }
  const { DUP2, DUP4, DUP6, NUM_SYMS } = setDistRange(outLen);
  const symEcoder = new AHuff(bio, NUM_SYMS);
  const windowSize = PRELOAD_SIZE + outLen;
  const win = new Uint8Array(windowSize);
  initializeModel(win);
  const base = PRELOAD_SIZE;
  let outBufSize = outLen;
  let outBuf = new Uint8Array(outBufSize);
  let outIdx = 0;
  let rleState = RLE_INITIAL;
  let rleEscape = 0;
  let rleCount = 0;
  const emitByte = (byte) => {
    if (!usingRunLength) {
      if (outIdx >= outBufSize) {
        outBufSize += outBufSize >>> 1;
        if (outBufSize > MAX_OUT) {
          throw new Error("LZCOMP output exceeds maximum size budget");
        }
        const tmp = new Uint8Array(outBufSize);
        tmp.set(outBuf);
        outBuf = tmp;
      }
      outBuf[outIdx++] = byte;
      return;
    }
    switch (rleState) {
      case RLE_INITIAL:
        rleEscape = byte;
        rleState = RLE_NORMAL;
        break;
      case RLE_NORMAL:
        if (byte === rleEscape) {
          rleState = RLE_SEEN_ESCAPE;
        } else {
          if (outIdx >= outBufSize) {
            outBufSize += outBufSize >>> 1;
            if (outBufSize > MAX_OUT) {
              throw new Error("LZCOMP output exceeds maximum size budget");
            }
            const tmp = new Uint8Array(outBufSize);
            tmp.set(outBuf);
            outBuf = tmp;
          }
          outBuf[outIdx++] = byte;
        }
        break;
      case RLE_SEEN_ESCAPE:
        rleCount = byte;
        if (rleCount === 0) {
          if (outIdx >= outBufSize) {
            outBufSize += outBufSize >>> 1;
            if (outBufSize > MAX_OUT) {
              throw new Error("LZCOMP output exceeds maximum size budget");
            }
            const tmp = new Uint8Array(outBufSize);
            tmp.set(outBuf);
            outBuf = tmp;
          }
          outBuf[outIdx++] = rleEscape;
          rleState = RLE_NORMAL;
        } else {
          rleState = RLE_NEED_BYTE;
        }
        break;
      case RLE_NEED_BYTE: {
        if (outIdx + rleCount > outBufSize) {
          outBufSize = outIdx + rleCount + (outBufSize >>> 1);
          if (outBufSize > MAX_OUT) {
            throw new Error("LZCOMP output exceeds maximum size budget");
          }
          const tmp = new Uint8Array(outBufSize);
          tmp.set(outBuf);
          outBuf = tmp;
        }
        for (let i = 0; i < rleCount; i++) {
          outBuf[outIdx++] = byte;
        }
        rleState = RLE_NORMAL;
        break;
      }
    }
  };
  for (let pos = 0; pos < outLen; ) {
    const symbol = symEcoder.readSymbol();
    let value;
    if (symbol < 256) {
      value = symbol;
    } else if (symbol === DUP2) {
      value = win[base + pos - 2];
    } else if (symbol === DUP4) {
      value = win[base + pos - 4];
    } else if (symbol === DUP6) {
      value = win[base + pos - 6];
    } else {
      const numDistRangesRef = [0];
      let length = decodeLength(lenEcoder, symbol, numDistRangesRef);
      const distance = decodeDistance(distEcoder, numDistRangesRef[0]);
      if (distance >= MAX_2BYTE_DIST) {
        length++;
      }
      const start = base + pos - distance - length + 1;
      for (let j = 0; j < length; j++) {
        value = win[start + j];
        win[base + pos] = value;
        pos++;
        emitByte(value);
      }
      continue;
    }
    win[base + pos] = value;
    pos++;
    emitByte(value);
  }
  return outBuf.subarray(0, outIdx);
}

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/sfnt-builder.ts
function lgFloor(n) {
  let ret = 0;
  while (n > 1) {
    n = Math.floor(n / 2);
    ret++;
  }
  return ret;
}
function maxPow2(n) {
  return 1 << lgFloor(n);
}
function writeOffsetTable(ctr, out) {
  const numTables = ctr.tables.length;
  const searchRange = maxPow2(numTables) * 16;
  const entrySelector = lgFloor(numTables);
  const rangeShift = numTables * 16 - searchRange;
  out.writeU32(65536);
  out.writeU16(numTables);
  out.writeU16(searchRange);
  out.writeU16(entrySelector);
  out.writeU16(rangeShift);
}
function writeTableDirectory(ctr, out) {
  for (const table of ctr.tables) {
    out.writeU8(table.tag.charCodeAt(0));
    out.writeU8(table.tag.charCodeAt(1));
    out.writeU8(table.tag.charCodeAt(2));
    out.writeU8(table.tag.charCodeAt(3));
    out.writeU32(table.checksum);
    out.writeU32(table.offset);
    out.writeU32(table.bufSize);
  }
}
function writeTableCheckingSum(table, out) {
  table.offset = out.pos;
  let checksum = 0;
  const data = table.buf;
  const len = table.bufSize;
  const fullWords = Math.floor(len / 4);
  const remainder = len % 4;
  for (let i = 0; i < fullWords; i++) {
    const off = i * 4;
    const word = (data[off] << 24 | data[off + 1] << 16 | data[off + 2] << 8 | data[off + 3]) >>> 0;
    checksum = checksum + word >>> 0;
    out.writeU32(word);
  }
  if (remainder > 0) {
    let word = 0;
    for (let j = 0; j < remainder; j++) {
      word |= data[fullWords * 4 + j] << 24 - j * 8;
    }
    word >>>= 0;
    checksum = checksum + word >>> 0;
    out.writeU32(word);
  }
  table.checksum = checksum;
}
function getTableDirectorySize(ctr) {
  return 16 * ctr.tables.length;
}
function getRequiredSize(ctr) {
  const offsetTableSize = 12;
  const dirSize = getTableDirectorySize(ctr);
  let tableDataSize = 0;
  for (const table of ctr.tables) {
    tableDataSize += Math.ceil(table.bufSize / 4) * 4;
  }
  return offsetTableSize + dirSize + tableDataSize;
}
function dumpContainer(ctr) {
  const requiredSize = getRequiredSize(ctr);
  const out = new Stream(new Uint8Array(requiredSize), 0);
  writeOffsetTable(ctr, out);
  const dirOffset = out.pos;
  const dirSize = getTableDirectorySize(ctr);
  out.pos += dirSize;
  let totalChecksum = 0;
  for (const table of ctr.tables) {
    writeTableCheckingSum(table, out);
    totalChecksum = totalChecksum + table.checksum >>> 0;
  }
  let headTable;
  for (const table of ctr.tables) {
    if (table.tag === "head") {
      headTable = table;
      break;
    }
  }
  const afterTables = out.pos;
  out.pos = dirOffset;
  writeTableDirectory(ctr, out);
  const beginningLen = 12 + dirSize;
  let beginningChecksum = 0;
  const buf = out.buf;
  const beginningWords = Math.floor(beginningLen / 4);
  for (let i = 0; i < beginningWords; i++) {
    const off = i * 4;
    const word = (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0;
    beginningChecksum = beginningChecksum + word >>> 0;
  }
  totalChecksum = totalChecksum + beginningChecksum >>> 0;
  const finalChecksum = 2981146554 - totalChecksum >>> 0;
  if (headTable) {
    const adjOffset = headTable.offset + 8;
    buf[adjOffset] = finalChecksum >>> 24 & 255;
    buf[adjOffset + 1] = finalChecksum >>> 16 & 255;
    buf[adjOffset + 2] = finalChecksum >>> 8 & 255;
    buf[adjOffset + 3] = finalChecksum & 255;
  }
  out.pos = afterTables;
  return out.buf.subarray(0, out.pos);
}

// Messenger/web/src/app/ui/mobile/viewers/vendor/mtx-decompressor/src/mtx-decompress.ts
var ENCRYPTION_KEY = 80;
function unpackMtx(data, size) {
  if (size < 10 || data.length < 10) {
    throw new Error("MTX data too small: header requires at least 10 bytes");
  }
  const versionMagic = data[0];
  const offset2 = data[4] << 16 | data[5] << 8 | data[6];
  const offset3 = data[7] << 16 | data[8] << 8 | data[9];
  if (offset2 < 10 || offset3 < offset2 || offset3 > size) {
    throw new Error(
      `MTX header offsets out of bounds: offset2=${offset2}, offset3=${offset3}, size=${size}`
    );
  }
  const offsets = [10, offset2, offset3];
  const blockSizes = [
    Math.max(0, offset2 - 10),
    Math.max(0, offset3 - offset2),
    Math.max(0, size - offset3)
  ];
  const streams = [];
  const decompressedSizes = [];
  for (let i = 0; i < 3; i++) {
    const block = data.subarray(offsets[i]);
    const decompressed = lzcompDecompress(block, blockSizes[i], versionMagic);
    streams.push(decompressed);
    decompressedSizes.push(decompressed.length);
  }
  return { streams, sizes: decompressedSizes };
}
function decompressMtx(fontData, options) {
  const encrypted = options?.encrypted ?? false;
  const compressed = options?.compressed ?? true;
  let data;
  if (encrypted) {
    data = new Uint8Array(fontData.length);
    for (let i = 0; i < fontData.length; i++) {
      data[i] = fontData[i] ^ ENCRYPTION_KEY;
    }
  } else {
    data = fontData;
  }
  if (!compressed) {
    return data;
  }
  const { streams } = unpackMtx(data, data.length);
  const streamObjects = streams.map((buf) => new Stream(buf, buf.length));
  const container = parseCTF(streamObjects);
  return dumpContainer(container);
}
function decompressEotFont(fontData, compressed, encrypted) {
  return decompressMtx(fontData, { encrypted, compressed });
}
export {
  decompressEotFont,
  decompressMtx,
  unpackMtx
};
