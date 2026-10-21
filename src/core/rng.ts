/**
 * Generador pseudoaleatori determinista xoshiro128** (Blackman i Vigna, 2018).
 * Només fa servir operacions d'enters de 32 bits: dona exactament la mateixa seqüència
 * a Safari, Chrome o Node. Prohibit fer servir Math.random al motor.
 */

/** Estat del generador: quatre enters sense signe de 32 bits. */
export type RngState = [number, number, number, number];

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Crea l'estat a partir d'una llavor de 16 bytes (128 bits). */
export function rngFromSeed(seed: Uint8Array): RngState {
  if (seed.length !== 16) throw new Error("La llavor ha de tenir 16 bytes");
  const v = new DataView(seed.buffer, seed.byteOffset, 16);
  const s: RngState = [v.getUint32(0, true), v.getUint32(4, true), v.getUint32(8, true), v.getUint32(12, true)];
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1; // l'estat tot zeros no és vàlid
  return s;
}

/** Següent enter de 32 bits. Modifica l'estat. */
export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Enter uniforme a [0, n). Rebutja els valors del tram final per evitar el biaix del mòdul. */
export function randomInt(s: RngState, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new Error("Interval no vàlid");
  const limit = Math.floor(0x100000000 / n) * n;
  for (;;) {
    const x = nextU32(s);
    if (x < limit) return x % n;
  }
}

/** Barreja de Fisher-Yates: tots els ordres possibles tenen la mateixa probabilitat. Modifica l'array. */
export function shuffle<T>(s: RngState, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(s, i + 1);
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}
