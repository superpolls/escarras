import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cellIndex, cellName, CENTER, PREMIUMS } from "../src/core/board";
import { nextU32, randomInt, rngFromSeed, shuffle, type RngState } from "../src/core/rng";
import { sha256, toHex } from "../src/core/sha256";

describe("generador xoshiro128**", () => {
  it("coincideix amb la implementació de referència en C", () => {
    const s: RngState = [1, 2, 3, 4];
    expect(Array.from({ length: 8 }, () => nextU32(s))).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849]);
    const t: RngState = [0xdeadbeef, 0x12345678, 0xcafebabe, 0x0badf00d];
    for (let i = 0; i < 1000; i++) nextU32(t);
    expect(nextU32(t)).toBe(3651887776);
  });

  it("la mateixa llavor dona la mateixa seqüència", () => {
    const seed = Uint8Array.from({ length: 16 }, (_, i) => i * 7);
    const a = rngFromSeed(seed), b = rngFromSeed(seed);
    for (let i = 0; i < 100; i++) expect(nextU32(a)).toBe(nextU32(b));
  });

  it("randomInt és uniforme (60.000 tirades d'un dau)", () => {
    const s = rngFromSeed(new Uint8Array(16).fill(9));
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[randomInt(s, 6)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });

  it("barrejar no perd ni duplica elements", () => {
    const s = rngFromSeed(new Uint8Array(16).fill(3));
    const items = Array.from({ length: 100 }, (_, i) => i);
    shuffle(s, items);
    expect([...items].sort((a, b) => a - b)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(items).not.toEqual(Array.from({ length: 100 }, (_, i) => i));
  });
});

describe("SHA-256 propi", () => {
  it("coincideix amb el de Node per a mides de 0 a 300 bytes", () => {
    for (let n = 0; n <= 300; n++) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 255);
      expect(toHex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
});

describe("tauler (reglament 3.1 de l'encàrrec)", () => {
  it("H8 és el centre", () => {
    expect(cellIndex("H8")).toBe(CENTER);
    expect(cellName(CENTER)).toBe("H8");
  });

  it("nombre de caselles premi", () => {
    const count = (k: string) => PREMIUMS.filter(p => p === k).length;
    expect([count("TW"), count("DW"), count("TL"), count("DL")]).toEqual([8, 17, 12, 24]);
  });

  it("el tauler és simètric (girs i reflexos)", () => {
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      const p = PREMIUMS[r * 15 + c];
      expect(PREMIUMS[c * 15 + r]).toBe(p);
      expect(PREMIUMS[r * 15 + (14 - c)]).toBe(p);
      expect(PREMIUMS[(14 - r) * 15 + c]).toBe(p);
    }
  });
});
