import { describe, expect, it } from "vitest";
import { CELLS, CENTER, colOf, rowOf, SIZE } from "../src/core/board";
import { decodeState, encodeState, stateHash } from "../src/core/codec";
import {
  activePlayers, applyAction, canUndo, checkPlay, createGame, currentPlayer, rackValue, senyorsAtTurnStart,
  senyorsAvailable, swapSenyors, tileInventoryOk, undoState, verifyTransition, type IsWord,
} from "../src/core/game";
import type { Action, GameState, Placement } from "../src/core/types";
import { dict, gameIdOf, seedOf, setup, word } from "./helpers";
import { anyWord, randomAction } from "./sim";

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
  it("es compleixen sempre els invariants, també amb abandonaments, votacions i entrades", () => {
    let seed = 2024;
    // Bits alts: els bits baixos d'un generador congruencial lineal tenen períodes molt curts
    const rnd = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
    let maxBytes = 0;
    const ends: Record<string, number> = {};
    const meta: Record<string, number> = {};
    for (let game = 0; game < 1000; game++) {
      const n = 2 + (game % 3);
      let s = createGame({ gameId: gameIdOf(game), seed: seedOf(game), names: Array.from({ length: n }, (_, i) => `Jugador ${i + 1}`) });
      let earned = 0;
      for (let step = 0; step < 600 && !s.ended; step++) {
        const prev = s;
        const active = activePlayers(prev);
        const pick = rnd(1000);
        let action: Action;
        let actor = prev.current;
        if (pick < 5) {
          actor = active[rnd(active.length)]!;
          action = { type: "leave" };
        } else if (pick < 15 && !prev.removal && active.length > 2) {
          const target = active[rnd(active.length)]!;
          actor = active.filter(p => p !== target)[0]!;
          action = { type: "vote-remove", target };
        } else if (prev.removal && pick < 800) {
          const pending = active.filter(p => p !== prev.removal!.target && !prev.removal!.votes.includes(p));
          actor = pending[0] ?? prev.current;
          action = pending.length ? { type: "vote-remove", target: prev.removal.target } : randomAction(prev, rnd);
        } else if (pick < 25 && active.length < 4 && prev.bag.length >= 7 && prev.players.length < 8) {
          action = { type: "join", name: `Nou ${prev.players.length + 1}` };
        } else if (pick < 35 && active.length < 4 && prev.bag.length >= 7 && prev.players.some(p => p.status !== "active")) {
          action = { type: "rejoin", player: prev.players.findIndex(p => p.status !== "active") };
        } else if (senyorsAtTurnStart(prev, prev.current) && rnd(2)) {
          action = { type: "senyors" };
        } else if (game % 10 === 0 && rnd(4)) {
          action = { type: "pass" }; // una de cada 10 partides passa molt sovint, per provocar bloquejos
        } else {
          action = randomAction(prev, rnd);
        }
        meta[action.type] = (meta[action.type] ?? 0) + 1;
        s = applyAction(prev, action, anyWord, actor);
        earned += s.last!.score;
        if (action.type === "join") earned += s.players.at(-1)!.score;
        if (action.type === "rejoin") earned += s.players[action.player]!.score - prev.players[action.player]!.score;
        const p = s.last!.player;
        while (senyorsAvailable(s, p) && rnd(2)) s = swapSenyors(s, p);

        expect(tileInventoryOk(s)).toBe(true);
        for (const pl of s.players) expect(pl.rack.length).toBeLessThanOrEqual(7);
        const act = activePlayers(s);
        expect(act.length).toBeLessThanOrEqual(4);
        expect([...s.order].sort()).toEqual(act);
        if (!s.ended) expect(s.order).toContain(s.current);
        for (const i of s.players.keys()) if (s.players[i]!.status !== "active") expect(s.players[i]!.rack).toEqual([]);
        expect(s.seq).toBe(prev.seq + 1);
        const bytes = encodeState(s);
        maxBytes = Math.max(maxBytes, bytes.length);
        expect(stateHash(decodeState(bytes))).toBe(stateHash(s));
        const v = verifyTransition(prev, s, anyWord);
        if (!v.ok) throw new Error(`Partida ${game}, pas ${step}: ${v.reason}`);
      }
      expect(s.ended).not.toBeNull();
      ends[s.ended!] = (ends[s.ended!] ?? 0) + 1;
      const total = s.players.reduce((a, pl) => a + pl.score, 0);
      const leftActive = activePlayers(s).reduce((a, i) => a + rackValue(s.players[i]!.rack), 0);
      expect(total).toBe(s.ended === "blocked" ? earned - leftActive : earned);
    }
    console.log("Finals:", ends, "· accions:", meta, `· estat més gran: ${maxBytes} bytes`);
    expect(ends.closed).toBeGreaterThan(0);
    expect(ends.blocked).toBeGreaterThan(0);
    expect(ends.abandoned).toBeGreaterThan(0);
    expect(maxBytes).toBeLessThan(400);
  }, 300000);
});
