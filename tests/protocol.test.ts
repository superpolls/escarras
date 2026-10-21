import { describe, expect, it } from "vitest";
import { CELLS, CENTER, colOf, rowOf, SIZE } from "../src/core/board";
import { decodeState, encodeState, stateHash } from "../src/core/codec";
import {
  applyAction, canUndo, checkPlay, createGame, currentPlayer, senyorsAvailable, swapSenyors,
  tileInventoryOk, undoState, verifyTransition, type IsWord,
} from "../src/core/game";
import type { Action, GameState, Placement } from "../src/core/types";
import { dict, gameIdOf, seedOf, setup, word } from "./helpers";

const anyWord: IsWord = () => true; // diccionari permissiu: prova la geometria i el protocol

/** Generador de jugades aleatòries per a la simulació (només existeix als tests). */
function randomAction(s: GameState, rnd: (n: number) => number): Action {
  const rack = s.players[currentPlayer(s)]!.rack;
  const empty = s.board.every(c => !c);
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

describe("serialització i empremta", () => {
  it("codificar i descodificar torna exactament el mateix estat", () => {
    const g = createGame({ gameId: gameIdOf(7), seed: seedOf(7), names: ["Núria", "Jordi", "Àngel", "Mercè"] });
    const d = decodeState(encodeState(g));
    expect(d).toEqual(g);
    expect(stateHash(d)).toBe(stateHash(g));
  });

  it("rebutja dades amb un format desconegut o truncades", () => {
    const bytes = encodeState(setup("C A S A E I O"));
    expect(() => decodeState(Uint8Array.from([9, ...bytes.subarray(1)]))).toThrow();
    expect(() => decodeState(bytes.subarray(0, bytes.length - 20))).toThrow();
  });
});

describe("desfer i verificació per repetició", () => {
  const isWord = dict("CASA");

  it("una jugada legítima es verifica repetint-la", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, isWord);
    expect(verifyTransition(g, n, isWord)).toEqual({ ok: true, replayed: true });
  });

  it("detecta manipulacions: punts, atrils, torn o cadena", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, isWord);
    const tamper = (f: (s: GameState) => void) => { const t = structuredClone(n); f(t); return verifyTransition(g, t, isWord).ok; };
    expect(tamper(s => { s.players[0]!.score = 99; })).toBe(false);
    expect(tamper(s => { s.players[1]!.rack[0] = 0; })).toBe(false);
    expect(tamper(s => { s.prevHash = "0123456789abcdef"; })).toBe(false);
    expect(tamper(s => { s.last!.player = 1; })).toBe(false);
    expect(tamper(s => { s.seq += 1; })).toBe(false);
  });

  it("qui ha jugat pot canviar el seu nom; un altre nom canviat no es verifica", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, isWord);
    const a = structuredClone(n); a.players[0]!.name = "Anna M.";
    const b = structuredClone(n); b.players[1]!.name = "Intrús";
    expect(verifyTransition(g, a, isWord).ok).toBe(true);
    expect(verifyTransition(g, b, isWord).ok).toBe(false);
  });

  it("desfer torna a l'estat anterior com a versió nova, i es verifica amb l'historial", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, isWord);
    expect(canUndo(n, 0)).toBe(true);
    expect(canUndo(n, 1)).toBe(false);
    const u = undoState(n, g);
    expect(u.seq).toBe(n.seq + 1);
    expect(u.board).toEqual(g.board);
    expect(u.players).toEqual(g.players);
    expect(currentPlayer(u)).toBe(0);
    expect(canUndo(u, 0)).toBe(false);
    expect(verifyTransition(n, u, isWord, [g])).toEqual({ ok: true, replayed: true });
    // Tornar a jugar després de desfer també es verifica
    const again = applyAction(u, { type: "pass" }, isWord);
    expect(verifyTransition(u, again, isWord).ok).toBe(true);
  });
});

describe("simulació: 1.000 partides amb jugades aleatòries", () => {
  it("es compleixen sempre els invariants", () => {
    let seed = 2024;
    // Bits alts: els bits baixos d'un generador congruencial lineal tenen períodes molt curts
    const rnd = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
    let maxBytes = 0;
    let closed = 0;
    let blocked = 0;
    for (let game = 0; game < 1000; game++) {
      const n = 2 + (game % 3);
      let s = createGame({ gameId: gameIdOf(game), seed: seedOf(game), names: Array.from({ length: n }, (_, i) => `Jugador ${i + 1}`) });
      let earned = 0;
      for (let step = 0; step < 400 && !s.ended; step++) {
        const prev = s;
        // Una de cada 10 partides passa molt sovint, per provocar també finals per bloqueig
        const action: Action = game % 10 === 0 && rnd(4) ? { type: "pass" } : randomAction(prev, rnd);
        s = applyAction(prev, action, anyWord);
        earned += s.last!.score;
        const p = s.last!.player;
        while (senyorsAvailable(s, p) && rnd(2)) s = swapSenyors(s, p);

        expect(tileInventoryOk(s)).toBe(true);
        for (const pl of s.players) expect(pl.rack.length).toBeLessThanOrEqual(7);
        expect(s.seq).toBe(prev.seq + 1);
        expect(s.turn).toBe(prev.turn + 1);
        const bytes = encodeState(s);
        maxBytes = Math.max(maxBytes, bytes.length);
        expect(stateHash(decodeState(bytes))).toBe(stateHash(s));
        const v = verifyTransition(prev, s, anyWord);
        if (!v.ok) throw new Error(`Partida ${game}, pas ${step}: ${v.reason}`);
      }
      expect(s.ended).not.toBeNull();
      if (s.ended === "closed") closed++; else blocked++;
      // Sense els ajustos finals, la suma de punts és la suma de les jugades
      const total = s.players.reduce((a, p) => a + p.score, 0);
      if (s.ended === "blocked") {
        const left = s.players.reduce((a, p) => a + p.rack.reduce((b, t) => b + [0, 1, 3, 2, 10, 2, 1, 4, 3, 8, 1, 8, 1, 10, 2, 1, 10, 1, 3, 8, 1, 1, 1, 1, 4, 10, 8][t]!, 0), 0);
        expect(total).toBe(earned - left);
      } else {
        expect(total).toBe(earned);
      }
    }
    console.log(`Partides tancades: ${closed}, bloquejades: ${blocked}; estat més gran: ${maxBytes} bytes`);
    expect(maxBytes).toBeLessThan(400);
  }, 120000);
});
