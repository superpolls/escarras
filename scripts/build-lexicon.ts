/**
 * Construeix el lèxic del joc a partir del DISC.
 *   npm run lexicon
 * Entrada:  lexicon/source/DISC2-LP.zip (versió fixada amb sha256)
 *           lexicon/afegits.tsv, lexicon/exclosos.tsv (opcionals, revisats a mà)
 *           lexicon/source/softcatala-formes.txt.gz (scripts/softcatala-source.ts, commit fixat amb sha256)
 * Sortida:  public/lexicon.bin, lexicon/manifest.json, lexicon/descartades.txt
 *           public/lexicon-softcatala.bin: només les formes de Softcatalà que el DISC no té (D-37)
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, unzipSync } from "fflate";
import { wordToTiles } from "../src/core/tiles";
import { buildLexicon, compareTiles, lexiconToBytes } from "../src/core/lexicon-build";

const SOURCE = "lexicon/source/DISC2-LP.zip";
const SOURCE_SHA256 = "c388f3ac86552151329e2593145ea14a5539aa8ae3114ca54ac585e6b7e29e2b";
const DISC_VERSION = "2.18.25";
const SC_SOURCE = "lexicon/source/softcatala-formes.txt.gz";
const SC_SHA256 = "35f2facf11c4bb168c2c260bb3253259a33a9c9eba1335ab8cfa71ff4210a6da";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const zip = readFileSync(SOURCE);
if (sha(zip) !== SOURCE_SHA256) throw new Error(`El fitxer ${SOURCE} no és la versió esperada del DISC`);
const files = unzipSync(zip);
const lp = Object.entries(files).find(([name]) => name.endsWith("DISC2-LP.txt"));
if (!lp) throw new Error("No trobo DISC2-LP.txt dins el zip");
const raw = new TextDecoder("utf-8").decode(lp[1]);

// Llistes revisades a mà: una paraula per línia, després un tabulador i la font o el motiu.
const readList = (path: string) =>
  existsSync(path)
    ? readFileSync(path, "utf8").split("\n").map(l => l.split("\t")[0]!.trim().toUpperCase()).filter(w => w && !w.startsWith("#"))
    : [];
const added = readList("lexicon/afegits.tsv");
const excluded = new Set(readList("lexicon/exclosos.tsv"));

const seen = new Set<string>();
const words: number[][] = [];
const discarded: string[] = [];
for (const line of [...raw.split(/\r?\n/), ...added]) {
  const w = line.trim();
  if (!w || seen.has(w)) continue;
  seen.add(w);
  if (excluded.has(w)) { discarded.push(`${w}\texclosa a mà`); continue; }
  const tiles = wordToTiles(w);
  if (!tiles) { discarded.push(`${w}\tno es pot formar amb fitxes`); continue; }
  if (tiles.length < 2 || tiles.length > 15) { discarded.push(`${w}\t${tiles.length} fitxes`); continue; }
  words.push(tiles);
}
words.sort(compareTiles);

const t0 = performance.now();
const lex = buildLexicon(words);
const bytes = lexiconToBytes(lex);
const ms = Math.round(performance.now() - t0);

mkdirSync("public", { recursive: true });
writeFileSync("public/lexicon.bin", bytes);
writeFileSync("lexicon/descartades.txt", discarded.join("\n") + "\n");
// Diccionari ampliat (D-37): formes de Softcatalà que el DISC no té i que es poden formar amb fitxes.
const scGz = readFileSync(SC_SOURCE);
if (sha(scGz) !== SC_SHA256) throw new Error(`El fitxer ${SC_SOURCE} no és la versió esperada`);
const scMeta = JSON.parse(readFileSync("lexicon/source/softcatala.json", "utf8")) as { commit: string };
const discKeys = new Set(words.map(t => t.join(",")));
const extra: number[][] = [];
for (const w of new TextDecoder("utf-8").decode(gunzipSync(scGz)).split("\n")) {
  if (!w || excluded.has(w)) continue;
  const tiles = wordToTiles(w);
  if (!tiles || tiles.length < 2 || tiles.length > 15) continue;
  const key = tiles.join(",");
  if (discKeys.has(key)) continue;
  discKeys.add(key);
  extra.push(tiles);
}
extra.sort(compareTiles);
const scLex = buildLexicon(extra);
const scBytes = lexiconToBytes(scLex);
writeFileSync("public/lexicon-softcatala.bin", scBytes);

const manifest = {
  font: `DISC ${DISC_VERSION} (Joan Montané, GPLv3 / CC-BY-SA 3.0)`,
  fontSha256: SOURCE_SHA256,
  afegides: added.length,
  excloses: excluded.size,
  formesDISC: raw.split(/\r?\n/).filter(Boolean).length,
  paraules: lex.wordCount,
  descartades: discarded.length,
  arestes: lex.edges.length,
  bytes: bytes.length,
  sha256: sha(bytes),
  softcatala: {
    font: `Softcatalà catalan-dict-tools ${scMeta.commit.slice(0, 12)} (LGPL-2.1)`,
    fontSha256: sha(scGz),
    paraulesNoves: scLex.wordCount,
    arestes: scLex.edges.length,
    bytes: scBytes.length,
    sha256: sha(scBytes),
  },
};
writeFileSync("lexicon/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log({ ...manifest, msConstruccio: ms });
