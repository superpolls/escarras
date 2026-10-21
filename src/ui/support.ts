import { stateHash } from "../core/codec";
import { Lexicon } from "../core/lexicon";
import { toHex } from "../core/sha256";
import type { GameState } from "../core/types";

let lexiconPromise: Promise<Lexicon> | null = null;

/** Carrega el diccionari una sola vegada. */
export function loadLexicon(): Promise<Lexicon> {
  lexiconPromise ??= fetch(`${import.meta.env.BASE_URL}lexicon.bin`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then(b => Lexicon.fromBytes(b))
    .catch(e => {
      lexiconPromise = null;
      throw e;
    });
  return lexiconPromise;
}

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
