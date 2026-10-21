/**
 * Lèxic compacte: un DAWG (graf acíclic dirigit de paraules) desat com a llista d'arestes.
 *
 * Cada aresta és un enter de 32 bits:
 *   bits 0-4  fitxa (1..26)
 *   bit  5    última germana (darrera aresta del node)
 *   bit  6    terminal (una paraula pot acabar just després d'aquesta fitxa)
 *   bits 7-31 índex de la primera aresta del node fill (0 = sense fills)
 * Les arestes de l'arrel comencen a l'índex 0.
 *
 * Format del fitxer: capçalera de 16 bytes ("ESCX", versió, nre. d'arestes, nre. de paraules)
 * i després les arestes en little-endian.
 */

export const LEXICON_MAGIC = 0x58435345; // "ESCX" llegit com a uint32 little-endian
export const LEXICON_FORMAT = 1;

const TILE_MASK = 0x1f;
const LAST = 1 << 5;
const TERMINAL = 1 << 6;
const CHILD_SHIFT = 7;

export class Lexicon {
  readonly edges: Uint32Array;
  readonly wordCount: number;

  constructor(edges: Uint32Array, wordCount: number) {
    this.edges = edges;
    this.wordCount = wordCount;
  }

  static fromBytes(buf: ArrayBuffer | Uint8Array): Lexicon {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== LEXICON_MAGIC) throw new Error("No és un fitxer de lèxic");
    if (view.getUint32(4, true) !== LEXICON_FORMAT) throw new Error("Versió de lèxic no suportada");
    const edgeCount = view.getUint32(8, true);
    const wordCount = view.getUint32(12, true);
    const edges = new Uint32Array(edgeCount);
    for (let i = 0; i < edgeCount; i++) edges[i] = view.getUint32(16 + i * 4, true);
    return new Lexicon(edges, wordCount);
  }

  /** Diu si la seqüència de fitxes és una paraula vàlida. Cost: com a molt 26 comparacions per fitxa. */
  has(tiles: readonly number[]): boolean {
    if (tiles.length === 0) return false;
    let idx = 0;
    for (let k = 0; k < tiles.length; k++) {
      const t = tiles[k];
      for (;;) {
        const e = this.edges[idx];
        if (e === undefined) return false;
        if ((e & TILE_MASK) === t) {
          if (k === tiles.length - 1) return (e & TERMINAL) !== 0;
          idx = e >>> CHILD_SHIFT;
          if (idx === 0) return false;
          break;
        }
        if (e & LAST) return false;
        idx++;
      }
    }
    return false;
  }

  /** Recorre totes les paraules (només per a tests i informes). */
  *words(): Generator<number[]> {
    const stack: { idx: number; prefix: number[] }[] = [{ idx: 0, prefix: [] }];
    while (stack.length) {
      const { idx: start, prefix } = stack.pop()!;
      let idx = start;
      for (;;) {
        const e = this.edges[idx]!;
        const word = [...prefix, e & TILE_MASK];
        if (e & TERMINAL) yield word;
        const child = e >>> CHILD_SHIFT;
        if (child !== 0) stack.push({ idx: child, prefix: word });
        if (e & LAST) break;
        idx++;
      }
    }
  }
}

export function encodeEdge(tile: number, last: boolean, terminal: boolean, child: number): number {
  if (child >= 1 << 25) throw new Error("Massa arestes per al format");
  return ((child << CHILD_SHIFT) | (terminal ? TERMINAL : 0) | (last ? LAST : 0) | tile) >>> 0;
}
