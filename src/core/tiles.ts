/**
 * Fitxes de l'Scrabble en català.
 * Font: FISC, «Distribució de fitxes» (https://www.fiscrabble.cat/recursos/distribucio-fitxes/)
 * i reglament AJUSC v1.1, punts 42-45.
 *
 * Cada fitxa té un identificador numèric (1..26) en ordre alfabètic català.
 * Aquest ordre també és el del sorteig d'inici (punt 3): escarràs < A < … < C < Ç < … < L < L·L < … < N < NY < … < Z.
 * L'escarràs (fitxa en blanc) és el 0.
 */

export const BLANK = 0;

/** Text de cada fitxa, indexat per identificador. L'índex 0 és l'escarràs. */
export const TILE_LABELS = [
  "", "A", "B", "C", "Ç", "D", "E", "F", "G", "H", "I", "J", "L", "L·L",
  "M", "N", "NY", "O", "P", "QU", "R", "S", "T", "U", "V", "X", "Z",
] as const;

export const TILE_COUNT = TILE_LABELS.length - 1; // 26 fitxes amb lletra

/** Valor en punts de cada fitxa (índex = identificador). */
export const TILE_VALUES: readonly number[] = [
  0, // escarràs
  1, 3, 2, 10, 2, 1, 4, 3, 8, 1, 8, 1, 10, // A B C Ç D E F G H I J L L·L
  2, 1, 10, 1, 3, 8, 1, 1, 1, 1, 4, 10, 8, // M N NY O P QU R S T U V X Z
];

/** Quantes fitxes de cada tipus hi ha a la bossa (índex = identificador). Total 100. */
export const TILE_DISTRIBUTION: readonly number[] = [
  2, // escarrassos
  12, 2, 3, 1, 3, 13, 1, 2, 1, 8, 1, 4, 1, // A B C Ç D E F G H I J L L·L
  3, 6, 1, 5, 2, 1, 8, 8, 5, 4, 1, 1, 1, //   M N NY O P QU R S T U V X Z
];

/** Vocals, per a la regla dels «senyors» (punt 32). Supòsit: QU compta com a consonant. */
export const VOWELS: ReadonlySet<number> = new Set([1, 6, 10, 17, 23]); // A E I O U

const ID_BY_LABEL = new Map<string, number>(TILE_LABELS.map((l, i) => [l, i]));

export function tileId(label: string): number | undefined {
  return ID_BY_LABEL.get(label);
}

/**
 * Converteix una paraula escrita (majúscules, sense accents, com al DISC) a la seqüència de fitxes.
 * Retorna null si la paraula no es pot formar amb fitxes catalanes:
 * lletres sense fitxa (K, W, Y fora de NY) o una Q no seguida de U (punt 42).
 *
 * Exemples: IL·LUS → I, L·L, U, S (4 fitxes); QUE → QU, E (2 fitxes); ANY → A, NY.
 */
export function wordToTiles(word: string): number[] | null {
  const tiles: number[] = [];
  let i = 0;
  while (i < word.length) {
    const ch = word[i]!;
    if (ch === "L" && word[i + 1] === "·" && word[i + 2] === "L") {
      tiles.push(13); i += 3; continue; // L·L
    }
    if (ch === "N" && word[i + 1] === "Y") {
      tiles.push(16); i += 2; continue; // NY
    }
    if (ch === "Q") {
      if (word[i + 1] !== "U") return null; // Q sense U: no es pot jugar
      tiles.push(19); i += 2; continue; // QU
    }
    const id = ID_BY_LABEL.get(ch);
    if (id === undefined || id === BLANK) return null; // K, W, Y solta, punt volat solt…
    tiles.push(id);
    i += 1;
  }
  return tiles;
}

/** Converteix una seqüència de fitxes a text llegible: [19, 6] → "QUE". */
export function tilesToWord(tiles: readonly number[]): string {
  return tiles.map(t => TILE_LABELS[t] ?? "?").join("");
}
