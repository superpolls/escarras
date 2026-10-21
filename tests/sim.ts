/** Generador de jugades aleatòries per a les simulacions (només existeix als tests). */
import { CELLS, CENTER, colOf, rowOf, SIZE } from "../src/core/board";
import { checkPlay, currentPlayer, type IsWord } from "../src/core/game";
import type { Action, GameState, Placement } from "../src/core/types";

export const anyWord: IsWord = () => true; // diccionari permissiu: prova la geometria i el protocol

/** Generador congruencial; es fan servir els bits alts (els baixos tenen períodes curts). */
export function makeRnd(seed: number): (n: number) => number {
  let x = seed >>> 0;
  return (n: number) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return (x >>> 8) % n; };
}

/** Generador de jugades aleatòries per a la simulació (només existeix als tests). */
export function randomAction(s: GameState, rnd: (n: number) => number): Action {
  const rack = s.players[currentPlayer(s)]!.rack;
  const empty = s.board.every(c => !c);
  if (s.bag.length >= 7 && rack.length && rnd(40) === 0) return { type: "exchange", tiles: rack.slice(0, 1 + rnd(rack.length)) };
  for (let attempt = 0; attempt < 30 && rack.length; attempt++) {
    const dir = rnd(2) ? 1 : SIZE;
    const k = 1 + rnd(rack.length);
    let cell: number;
    if (empty) {
      cell = CENTER - rnd(k) * dir;
    } else {
      const anchors = [...Array(CELLS).keys()].filter(i => !s.board[i] && [i - 1, i + 1, i - SIZE, i + SIZE].some(n => n >= 0 && n < CELLS && s.board[n] && (Math.abs(colOf(n) - colOf(i)) <= 1)));
      if (!anchors.length) break;
      cell = anchors[rnd(anchors.length)]!;
    }
    const tiles = [...rack];
    const placements: Placement[] = [];
    let i = cell;
    while (placements.length < k && i < CELLS && (dir === SIZE || rowOf(i) === rowOf(cell))) {
      if (!s.board[i]) {
        const tile = tiles.splice(rnd(tiles.length), 1)[0]!;
        placements.push({ index: i, tile, letter: tile === 0 ? 1 + rnd(26) : tile });
      }
      i += dir;
    }
    if (placements.length && checkPlay(s, placements, anyWord).ok) return { type: "play", placements };
  }
  if (s.bag.length >= 7 && rack.length) return { type: "exchange", tiles: rack.slice(0, 1 + rnd(rack.length)) };
  return { type: "pass" };
}

