import { stateHash } from "../core/codec";
import { Lexicon } from "../core/lexicon";
import { toHex } from "../core/sha256";
import type { GameState } from "../core/types";

export interface Lexicons {
  /** DISC: el diccionari oficial. */
  disc: Lexicon;
  /** Paraules de Softcatalà que el DISC no té (D-37). */
  softcatala: Lexicon;
}

let lexiconPromise: Promise<Lexicons> | null = null;

const fetchLexicon = (file: string) =>
  fetch(`${import.meta.env.BASE_URL}${file}`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then(b => Lexicon.fromBytes(b));

/**
 * Carrega els dos diccionaris una sola vegada, en paral·lel.
 * Es carreguen tots dos sempre: un mòbil ha de poder verificar qualsevol partida que li arribi, sense connexió.
 */
export function loadLexicon(): Promise<Lexicons> {
  lexiconPromise ??= Promise.all([fetchLexicon("lexicon.bin"), fetchLexicon("lexicon-softcatala.bin")])
    .then(([disc, softcatala]) => ({ disc, softcatala }))
    .catch(e => {
      lexiconPromise = null;
      throw e;
    });
  return lexiconPromise;
}

/** Validador de paraules per al motor: el DISC sempre; Softcatalà només si la partida ho diu. */
export const wordChecker = (l: Lexicons) => (t: readonly number[], softcatala: boolean) => l.disc.has(t) || (softcatala && l.softcatala.has(t));

/** Atzar real del sistema per a la llavor i l'identificador de partida. */
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export const newGameId = () => toHex(randomBytes(16));

/** Codi de control de 4 caràcters, sense caràcters que es confonguin (0/O, 1/I). */
const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3479";
export function controlCode(s: GameState): string {
  const h = stateHash(s);
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[parseInt(h.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  return out;
}

export function vibrate(ms = 40): void {
  try { navigator.vibrate?.(ms); } catch { /* res */ }
}
