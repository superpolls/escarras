/**
 * Tauler de 15×15. Columnes A-O (d'esquerra a dreta), files 1-15 (de dalt a baix).
 * Cada casella té un índex 0..224 = fila * 15 + columna. El centre, H8, és l'índex 112.
 */
export const SIZE = 15;
export const CELLS = SIZE * SIZE;
export const CENTER = 7 * SIZE + 7;

export type Premium = "TW" | "DW" | "TL" | "DL";

export const rowOf = (i: number) => Math.floor(i / SIZE);
export const colOf = (i: number) => i % SIZE;

/** "H8" → 112 */
export function cellIndex(name: string): number {
  const col = name.charCodeAt(0) - 65;
  const row = Number(name.slice(1)) - 1;
  if (col < 0 || col >= SIZE || !(row >= 0 && row < SIZE)) throw new Error(`Casella no vàlida: ${name}`);
  return row * SIZE + col;
}

/** 112 → "H8" */
export function cellName(i: number): string {
  return String.fromCharCode(65 + colOf(i)) + (rowOf(i) + 1);
}

const LAYOUT: Record<Premium, string> = {
  TW: "A1 H1 O1 A8 O8 A15 H15 O15",
  DW: "B2 C3 D4 E5 K5 L4 M3 N2 B14 C13 D12 E11 K11 L12 M13 N14 H8",
  TL: "F2 J2 B6 F6 J6 N6 B10 F10 J10 N10 F14 J14",
  DL: "D1 L1 G3 I3 A4 H4 O4 C7 G7 I7 M7 D8 L8 C9 G9 I9 M9 A12 H12 O12 G13 I13 D15 L15",
};

/** Casella premi de cada índex (o null). */
export const PREMIUMS: readonly (Premium | null)[] = (() => {
  const p: (Premium | null)[] = new Array(CELLS).fill(null);
  for (const [kind, cells] of Object.entries(LAYOUT) as [Premium, string][]) {
    for (const c of cells.split(" ")) p[cellIndex(c)] = kind;
  }
  return p;
})();

export const letterMultiplier = (i: number) => (PREMIUMS[i] === "DL" ? 2 : PREMIUMS[i] === "TL" ? 3 : 1);
export const wordMultiplier = (i: number) => (PREMIUMS[i] === "DW" ? 2 : PREMIUMS[i] === "TW" ? 3 : 1);
