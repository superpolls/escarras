/** Diccionari ampliat amb Softcatalà, triat en crear la partida (D-37). */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { cellIndex } from "../src/core/board";
import { decodeState, encodeState, stateHash } from "../src/core/codec";
import { applyAction, checkPlay, createGame, verifyTransition, type IsWord } from "../src/core/game";
import { Lexicon } from "../src/core/lexicon";
import { wordToTiles } from "../src/core/tiles";
import { gameIdOf, seedOf, setup, word } from "./helpers";

describe("lèxic de Softcatalà (public/lexicon-softcatala.bin)", () => {
  let disc: Lexicon;
  let sc: Lexicon;
  const has = (l: Lexicon, w: string) => l.has(wordToTiles(w)!);
  beforeAll(() => {
    disc = Lexicon.fromBytes(readFileSync("public/lexicon.bin"));
    sc = Lexicon.fromBytes(readFileSync("public/lexicon-softcatala.bin"));
  });

  it("té les paraules que el DISC no té, com «traçable»", () => {
    for (const w of ["TRAÇABLE", "TRAÇABLES", "ABRAÇABLE", "ACONSEGUIBLE"]) {
      expect(has(disc, w), `${w} al DISC`).toBe(false);
      expect(has(sc, w), `${w} a Softcatalà`).toBe(true);
    }
  });

  it("no repeteix cap paraula del DISC", () => {
    for (const w of sc.words()) if (disc.has(w)) throw new Error(`Repetida: ${w}`);
  });

  it("no hi ha noms propis ni barbarismes", () => {
    for (const w of ["BARCELONA", "GIRONA", "BUENO", "HASTA", "ENTONCES"]) expect(has(sc, w), w).toBe(false);
  });

  it("el manifest coincideix amb el fitxer", () => {
    const m = JSON.parse(readFileSync("lexicon/manifest.json", "utf8"));
    expect(m.softcatala.paraulesNoves).toBe(sc.wordCount);
    expect(m.softcatala.paraulesNoves).toBeGreaterThan(200000);
  });
});

describe("opció de la partida", () => {
  // DISC fictici sense TRAÇABLE; Softcatalà fictici amb TRAÇABLE
  const isWord: IsWord = (t, softcatala) => {
    const w = t.join(",");
    return w === wordToTiles("TRAÇA")!.join(",") || (softcatala && w === wordToTiles("TRAÇABLE")!.join(","));
  };
  /** Atril TRAÇABL i una E de la bossa ja al tauler, just a la dreta d'on acabarà la paraula. */
  const withRack = (softcatala: boolean) => {
    const g = setup("T R A Ç A B L");
    g.softcatala = softcatala;
    const E = wordToTiles("E")![0]!;
    g.bag.splice(g.bag.indexOf(E), 1);
    g.board[cellIndex("O8")] = { tile: E, letter: E };
    return g;
  };

  it("per defecte una partida nova només accepta el DISC", () => {
    const g = createGame({ gameId: gameIdOf(1), seed: seedOf(1), names: ["Anna", "Biel"] });
    expect(g.softcatala).toBe(false);
    expect(createGame({ gameId: gameIdOf(1), seed: seedOf(1), names: ["Anna", "Biel"], softcatala: true }).softcatala).toBe(true);
  });

  it("«traçable» no val sense l'opció i val amb l'opció", () => {
    const off = withRack(false);
    const on = withRack(true);
    const p = word("H8", "TRAÇABL", "H");
    const a = checkPlay(off, p, isWord);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe("invalid-words");
    const b = checkPlay(on, p, isWord);
    expect(b.ok).toBe(true);
  });

  it("l'opció viatja amb l'estat i un altre mòbil verifica la jugada", () => {
    const g = withRack(true);
    const next = applyAction(g, { type: "play", placements: word("H8", "TRAÇABL", "H") }, isWord);
    expect(next.softcatala).toBe(true);
    const received = decodeState(encodeState(next));
    expect(received.softcatala).toBe(true);
    expect(verifyTransition(g, received, isWord).ok).toBe(true);
  });

  it("canviar l'opció a mitja partida no es verifica", () => {
    const g = withRack(false);
    const next = applyAction({ ...g, softcatala: true }, { type: "play", placements: word("H8", "TRAÇABL", "H") }, isWord);
    next.prevHash = stateHash(g);
    expect(verifyTransition(g, next, isWord).ok).toBe(false);
  });
});

describe("codificació", () => {
  it("sense Softcatalà: format 1, igual que abans (no canvien les empremtes de les partides en curs)", () => {
    const b = encodeState(setup("C A S A E I O"));
    expect(b[0]).toBe(1);
  });

  it("amb Softcatalà: format 2 i el diccionari al segon byte", () => {
    const g = setup("C A S A E I O");
    g.softcatala = true;
    const b = encodeState(g);
    expect([b[0], b[1]]).toEqual([2, 1]);
    expect(decodeState(b)).toEqual(g);
    expect(stateHash(g)).not.toBe(stateHash({ ...g, softcatala: false }));
  });

  it("rebutja un format 2 amb un diccionari desconegut o sense Softcatalà", () => {
    const g = setup("C A S A E I O");
    g.softcatala = true;
    const b = encodeState(g);
    for (const d of [0, 2, 255]) expect(() => decodeState(Uint8Array.from([2, d, ...b.subarray(2)]))).toThrow();
  });
});
