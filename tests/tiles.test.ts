import { describe, expect, it } from "vitest";
import { TILE_DISTRIBUTION, TILE_LABELS, TILE_VALUES, tilesToWord, wordToTiles } from "../src/core/tiles";

describe("fitxes (FISC: distribució de fitxes)", () => {
  it("hi ha 100 fitxes, 2 de les quals escarrassos", () => {
    expect(TILE_DISTRIBUTION.reduce((a, b) => a + b, 0)).toBe(100);
    expect(TILE_DISTRIBUTION[0]).toBe(2);
  });

  it("valors i quantitats coincideixen amb la taula oficial", () => {
    const table: Record<string, [number, number]> = {
      E: [1, 13], A: [1, 12], I: [1, 8], R: [1, 8], S: [1, 8], N: [1, 6], O: [1, 5], T: [1, 5], L: [1, 4], U: [1, 4],
      C: [2, 3], D: [2, 3], M: [2, 3], B: [3, 2], G: [3, 2], P: [3, 2], F: [4, 1], V: [4, 1],
      H: [8, 1], J: [8, 1], QU: [8, 1], Z: [8, 1], "Ç": [10, 1], "L·L": [10, 1], NY: [10, 1], X: [10, 1],
    };
    for (const [label, [value, count]] of Object.entries(table)) {
      const id = TILE_LABELS.indexOf(label as (typeof TILE_LABELS)[number]);
      expect(id, label).toBeGreaterThan(0);
      expect(TILE_VALUES[id], `valor de ${label}`).toBe(value);
      expect(TILE_DISTRIBUTION[id], `quantitat de ${label}`).toBe(count);
    }
    expect(Object.keys(table)).toHaveLength(26);
  });

  it("no hi ha K, W ni Y", () => {
    for (const l of ["K", "W", "Y"]) expect(TILE_LABELS).not.toContain(l);
  });
});

describe("conversió de paraules a fitxes (reglament, punts 42-44)", () => {
  it("L·L, NY i QU són una sola fitxa", () => {
    expect(wordToTiles("IL·LUS")).toHaveLength(4);
    expect(wordToTiles("QUE")).toHaveLength(2);
    expect(wordToTiles("ANY")).toHaveLength(2);
    expect(wordToTiles("COL·LEGI")).toHaveLength(6);
    expect(wordToTiles("QUEQUI")).toHaveLength(4);
  });

  it("dues L sense punt volat són dues fitxes L", () => {
    expect(wordToTiles("BALLA")).toHaveLength(5);
  });

  it("rebutja el que no es pot formar amb fitxes", () => {
    expect(wordToTiles("QAF")).toBeNull(); // Q sense U
    expect(wordToTiles("KIWI")).toBeNull();
    expect(wordToTiles("YOGA")).toBeNull(); // Y sola
  });

  it("anada i tornada", () => {
    for (const w of ["IL·LUS", "QUE", "ANY", "PLAÇA", "XARXA"]) expect(tilesToWord(wordToTiles(w)!)).toBe(w);
  });
});
