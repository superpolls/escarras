/**
 * Construeix el lèxic del joc a partir del DISC.
 *   npm run lexicon
 * Entrada:  lexicon/source/DISC2-LP.zip (versió fixada amb sha256)
 *           lexicon/afegits.tsv, lexicon/exclosos.tsv (opcionals, revisats a mà)
 * Sortida:  public/lexicon.bin, lexicon/manifest.json, lexicon/descartades.txt
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { wordToTiles } from "../src/core/tiles";
import { buildLexicon, compareTiles, lexiconToBytes } from "../src/core/lexicon-build";

const SOURCE = "lexicon/source/DISC2-LP.zip";
const SOURCE_SHA256 = "c388f3ac86552151329e2593145ea14a5539aa8ae3114ca54ac585e6b7e29e2b";
const DISC_VERSION = "2.18.25";

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
};
writeFileSync("lexicon/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log({ ...manifest, msConstruccio: ms });
