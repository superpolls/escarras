import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { Lexicon } from "../src/core/lexicon";
import { buildLexicon, compareTiles } from "../src/core/lexicon-build";
import { wordToTiles } from "../src/core/tiles";

const has = (lex: Lexicon, w: string) => {
  const t = wordToTiles(w);
  return t !== null && lex.has(t);
};

describe("DAWG amb una llista petita", () => {
  const words = ["CANT", "CANTA", "CANTAR", "CANTEM", "PLAÇA", "QUE", "QUI"].map(w => wordToTiles(w)!).sort(compareTiles);
  const lex = buildLexicon(words);

  it("troba totes les paraules i res més", () => {
    for (const w of words) expect(lex.has(w)).toBe(true);
    for (const w of ["CAN", "CANTE", "CANTARS", "PLAÇ", "QU", "Q"]) expect(has(lex, w), w).toBe(false);
    expect([...lex.words()]).toHaveLength(words.length);
  });
});

describe("lèxic complet (public/lexicon.bin, DISC 2.18.25)", () => {
  let lex: Lexicon;
  let disc: string[];
  let discKeys: Set<string>;

  beforeAll(() => {
    lex = Lexicon.fromBytes(readFileSync("public/lexicon.bin"));
    const files = unzipSync(readFileSync("lexicon/source/DISC2-LP.zip"));
    const txt = Object.entries(files).find(([n]) => n.endsWith("DISC2-LP.txt"))![1];
    disc = new TextDecoder().decode(txt).split(/\r?\n/).filter(Boolean);
    discKeys = new Set(disc.map(w => wordToTiles(w)!.join(",")));
  });

  it("conté totes les formes del DISC", () => {
    const missing = disc.filter(w => !has(lex, w));
    expect(missing.slice(0, 10)).toEqual([]);
  });

  it("no conté cap paraula que no sigui al DISC", () => {
    let count = 0;
    for (const w of lex.words()) {
      count++;
      if (!discKeys.has(w.join(","))) throw new Error(`Paraula de més: ${w}`);
    }
    expect(count).toBe(disc.length);
  });

  it("rebutja variacions inventades (20.000 mutacions)", () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) >>> 0; return seed % n; };
    for (let i = 0; i < 20000; i++) {
      const base = wordToTiles(disc[rnd(disc.length)]!)!;
      const m = [...base];
      m[rnd(m.length)] = 1 + rnd(26);
      expect(lex.has(m)).toBe(discKeys.has(m.join(",")));
    }
  });

  it("rebutja barbarismes", () => {
    // Atenció als homògrafs: PUES (plural de «pua») i ACERA (d'«acerar») són catalanes i vàlides.
    const barbarismes = ["BUENO", "HASTA", "DESDE", "ENHORABUENA", "ENTONCES", "ALREDEDOR", "BASURA",
      "RECADO", "DESPEDIDA", "BOSTESO", "TENEDOR", "BARRENDERO", "ESTUPENDO"];
    expect(barbarismes.filter(w => has(lex, w))).toEqual([]);
  });

  it("inclou la mostra de formes valencianes i balears (lexicon/mostra-dialectal.tsv)", () => {
    const sample = readFileSync("lexicon/mostra-dialectal.tsv", "utf8").split("\n")
      .filter(l => l && !l.startsWith("#")).map(l => l.split("\t")[0]!);
    expect(sample.length).toBeGreaterThan(60);
    expect(sample.filter(w => !has(lex, w))).toEqual([]);
  });

  it("accepta paraules amb dígrafs", () => {
    for (const w of ["QUE", "ANY", "COL·LEGI", "IL·LUSIO", "PLAÇA", "XARXA", "QUAQUER", "ENQUESTA"]) expect(has(lex, w), w).toBe(true);
  });
});
