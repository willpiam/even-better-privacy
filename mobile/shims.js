import {Buffer} from 'buffer';

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class TextEncoder {
    encoding = 'utf-8';
    encode(str) {
      return new Uint8Array(Buffer.from(str, 'utf-8'));
    }
    encodeInto(str, dest) {
      const buf = Buffer.from(str, 'utf-8');
      const len = Math.min(buf.length, dest.length);
      dest.set(buf.subarray(0, len));
      return {read: str.length, written: len};
    }
  };
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class TextDecoder {
    encoding = 'utf-8';
    constructor(label = 'utf-8') {
      this.encoding = label;
    }
    decode(bytes) {
      if (!bytes) {
        return '';
      }
      return Buffer.from(bytes).toString(this.encoding);
    }
  };
}
