/**
 * Synchronous SHA-1 / SHA-256 in plain TypeScript. Mago's modules call
 * node:crypto's createHash; the browser has only async SubtleCrypto, and these
 * pipelines hash inside synchronous code, so the digests are implemented here
 * and checked against node:crypto in tests/mago.test.ts.
 */

const utf8 = new TextEncoder();

const pad = (message: Uint8Array): Uint8Array => {
  const bitLength = message.length * 8;
  const total = (((message.length + 8) >> 6) + 1) << 6;
  const out = new Uint8Array(total);
  out.set(message);
  out[message.length] = 0x80;
  const view = new DataView(out.buffer);
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(total - 4, bitLength >>> 0);
  return out;
};

const hex = (words: number[]): string =>
  words.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export const sha1Hex = (text: string): string => {
  const data = pad(utf8.encode(text));
  const view = new DataView(data.buffer);
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Array<number>(80);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++)
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = h as [number, number, number, number, number];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h[0] = (h[0]! + a) | 0;
    h[1] = (h[1]! + b) | 0;
    h[2] = (h[2]! + c) | 0;
    h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0;
  }
  return hex(h);
};

const K256 = new Uint32Array(64);
{
  let n = 2;
  let count = 0;
  while (count < 64) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (prime) {
      K256[count++] = Math.floor((Math.cbrt(n) % 1) * 0x100000000);
    }
    n++;
  }
}
const H256 = (() => {
  const out: number[] = [];
  let n = 2;
  while (out.length < 8) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) prime = false;
    if (prime) out.push(Math.floor((Math.sqrt(n) % 1) * 0x100000000));
    n++;
  }
  return out;
})();

export const sha256Hex = (text: string): string => {
  const data = pad(utf8.encode(text));
  const view = new DataView(data.buffer);
  const h = [...H256];
  const w = new Array<number>(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as number[] as [
      number, number, number, number, number, number, number, number
    ];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i]! + add[i]!) | 0;
  }
  return hex(h);
};
