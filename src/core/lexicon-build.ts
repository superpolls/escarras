/**
 * Construcció del DAWG a partir d'una llista de paraules en fitxes.
 * Algorisme de Daciuk et al. (2000): insereix les paraules ordenades i va fusionant
 * els nodes equivalents (mateixos fills i mateix final) a mesura que avança.
 * Resultat: el graf mínim, on els principis i els finals comuns es comparteixen.
 */
import { encodeEdge, LEXICON_FORMAT, LEXICON_MAGIC, Lexicon } from "./lexicon";

interface Node {
  final: boolean;
  edges: [number, Node][]; // ordenades per fitxa, perquè l'entrada ve ordenada
  key?: string;
  id?: number;
}

export function compareTiles(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

export function buildLexicon(sortedWords: readonly (readonly number[])[]): Lexicon {
  const root: Node = { final: false, edges: [] };
  const register = new Map<string, Node>();
  let nextId = 0;
  let prev: readonly number[] = [];

  const signature = (n: Node) => (n.final ? "1" : "0") + n.edges.map(([t, c]) => `${t}:${c.id}`).join(",");

  // Substitueix els nodes de la cua de l'última paraula per equivalents ja registrats.
  const minimize = (node: Node): void => {
    const lastEdge = node.edges[node.edges.length - 1];
    if (!lastEdge) return;
    const child = lastEdge[1];
    if (child.id === undefined) {
      minimize(child);
      const key = signature(child);
      const existing = register.get(key);
      if (existing) lastEdge[1] = existing;
      else { child.id = nextId++; register.set(key, child); }
    }
  };

  for (const word of sortedWords) {
    if (compareTiles(prev, word) >= 0 && prev.length) throw new Error("Paraules no ordenades o repetides");
    let common = 0;
    while (common < word.length && common < prev.length && word[common] === prev[common]) common++;
    // Baixa pel prefix comú
    let node = root;
    for (let i = 0; i < common; i++) node = node.edges[node.edges.length - 1]![1];
    minimize(node);
    // Afegeix el sufix nou
    for (let i = common; i < word.length; i++) {
      const child: Node = { final: false, edges: [] };
      node.edges.push([word[i]!, child]);
      node = child;
    }
    node.final = true;
    prev = word;
  }
  minimize(root);

  // Aplana el graf: cada node rep un bloc contigu d'arestes, l'arrel a l'índex 0.
  const blockStart = new Map<Node, number>();
  const order: Node[] = [];
  const queue: Node[] = [root];
  let cursor = 0;
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q]!;
    if (blockStart.has(n) || n.edges.length === 0) continue;
    blockStart.set(n, cursor);
    cursor += n.edges.length;
    order.push(n);
    for (const [, c] of n.edges) if (!blockStart.has(c) && c.edges.length) queue.push(c);
  }
  const edges = new Uint32Array(cursor);
  let i = 0;
  for (const n of order) {
    n.edges.forEach(([t, c], k) => {
      edges[i++] = encodeEdge(t, k === n.edges.length - 1, c.final, c.edges.length ? blockStart.get(c)! : 0);
    });
  }
  return new Lexicon(edges, sortedWords.length);
}

export function lexiconToBytes(lex: Lexicon): Uint8Array {
  const out = new Uint8Array(16 + lex.edges.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, LEXICON_MAGIC, true);
  view.setUint32(4, LEXICON_FORMAT, true);
  view.setUint32(8, lex.edges.length, true);
  view.setUint32(12, lex.wordCount, true);
  lex.edges.forEach((e, k) => view.setUint32(16 + k * 4, e, true));
  return out;
}
