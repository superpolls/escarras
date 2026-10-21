/** Utilitats de bytes: Base64 per a URL, Base45 per als QR i suma de control FNV-1a. */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Base64 per a URL, sense farciment (`=`): es pot posar en un enllaç o en una ruta del servidor. */
export function toB64u(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2;
    for (let k = 0; k < chars; k++) out += B64[(n >> (18 - 6 * k)) & 63];
  }
  return out;
}

export function fromB64u(text: string): Uint8Array {
  const vals = Array.from(text, c => {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error("Base64 no vàlid");
    return v;
  });
  if (vals.length % 4 === 1) throw new Error("Base64 no vàlid");
  const out: number[] = [];
  for (let i = 0; i < vals.length; i += 4) {
    const n = (vals[i]! << 18) | ((vals[i + 1] ?? 0) << 12) | ((vals[i + 2] ?? 0) << 6) | (vals[i + 3] ?? 0);
    out.push((n >> 16) & 255);
    if (i + 2 < vals.length) out.push((n >> 8) & 255);
    if (i + 3 < vals.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

/** Base45 (RFC 9285): cap al mode alfanumèric dels QR, més compacte que el mode binari. */
const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

export function toB45(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i]! * 256 + bytes[i + 1]!;
      out += B45[n % 45]! + B45[Math.floor(n / 45) % 45]! + B45[Math.floor(n / 2025)]!;
    } else {
      const n = bytes[i]!;
      out += B45[n % 45]! + B45[Math.floor(n / 45)]!;
    }
  }
  return out;
}

export function fromB45(text: string): Uint8Array {
  const out: number[] = [];
  const val = (c: string | undefined) => {
    const v = c === undefined ? -1 : B45.indexOf(c);
    if (v < 0) throw new Error("Base45 no vàlid");
    return v;
  };
  for (let i = 0; i < text.length; i += 3) {
    if (i + 2 < text.length) {
      const n = val(text[i]) + val(text[i + 1]) * 45 + val(text[i + 2]) * 2025;
      if (n > 65535) throw new Error("Base45 no vàlid");
      out.push(n >> 8, n & 255);
    } else {
      const n = val(text[i]) + val(text[i + 1]) * 45;
      if (n > 255) throw new Error("Base45 no vàlid");
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}

/** FNV-1a de 32 bits: detecta si un QR s'ha llegit alterat. */
export function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
