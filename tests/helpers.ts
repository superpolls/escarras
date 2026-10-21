import { cellIndex } from "../src/core/board";
import { createGame, type IsWord } from "../src/core/game";
import { tilesToWord, wordToTiles } from "../src/core/tiles";
import type { GameState, Placement } from "../src/core/types";

export const T = (w: string) => {
  const t = wordToTiles(w);
  if (!t) throw new Error(`No es pot convertir ${w}`);
  return t;
};

/** Diccionari de prova a partir d'una llista de paraules. */
export const dict = (...words: string[]): IsWord => {
  const set = new Set(words);
  return tiles => set.has(tilesToWord(tiles));
};

export const seedOf = (n: number) => {
  const s = new Uint8Array(16);
  new DataView(s.buffer).setUint32(0, n + 1, true);
  new DataView(s.buffer).setUint32(8, (n * 2654435761) >>> 0, true);
  return s;
};

export const gameIdOf = (n: number) => n.toString(16).padStart(32, "0");

/** Partida de prova amb el jugador 0 a qui toca i un atril controlat ('?' = escarràs). */
export function setup(rack: string, names = ["Anna", "Biel"]): GameState {
  const g = createGame({ gameId: gameIdOf(1), seed: seedOf(1), names });
  g.first = 0;
  g.current = 0;
  g.order = names.map((_, i) => i);
  // Canvia l'atril mantenint les 100 fitxes: les antigues tornen a la bossa i les noves en surten
  g.bag.push(...g.players[0]!.rack);
  const wanted = rack.split(" ").filter(Boolean).flatMap(x => (x === "?" ? [0] : T(x)));
  for (const t of wanted) {
    const k = g.bag.indexOf(t);
    if (k >= 0) g.bag.splice(k, 1);
  }
  g.players[0]!.rack = wanted;
  return g;
}

/** Posa fitxes al tauler directament (per preparar situacions). */
export function put(g: GameState, start: string, word: string, dir: "H" | "V"): void {
  let i = cellIndex(start);
  for (const t of T(word)) {
    g.board[i] = { tile: t, letter: t };
    i += dir === "H" ? 1 : 15;
  }
}

/** Col·locacions d'una paraula a partir d'una casella. Les lletres en minúscula es fan amb escarràs. */
export function word(start: string, w: string, dir: "H" | "V"): Placement[] {
  const out: Placement[] = [];
  let i = cellIndex(start);
  const parts = w.match(/L·L|l·l|NY|ny|QU|qu|./g)!;
  for (const p of parts) {
    const letter = T(p.toUpperCase())[0]!;
    const blank = p !== p.toUpperCase();
    out.push({ index: i, tile: blank ? 0 : letter, letter });
    i += dir === "H" ? 1 : 15;
  }
  return out;
}
