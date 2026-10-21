import type { RngState } from "./rng";

/** Una fitxa al tauler. `tile` és 0 si és un escarràs; `letter` és la fitxa que representa. */
export interface Cell {
  tile: number;
  letter: number;
}

/** Una fitxa col·locada en una jugada. */
export interface Placement {
  index: number;
  tile: number; // fitxa de l'atril (0 = escarràs)
  letter: number; // fitxa que representa (igual que `tile` si no és escarràs)
}

export type Action =
  | { type: "play"; placements: Placement[] }
  | { type: "exchange"; tiles: number[] }
  | { type: "pass" };

export interface LastAction {
  player: number;
  action: Action | { type: "undo" };
  score: number;
  /** Canvis de «senyors» fets just després de robar, dins la mateixa jugada (punt 32). */
  senyorsSwaps: number;
}

export interface Player {
  name: string;
  score: number;
  rack: number[];
  /** Canvis de senyors consecutius en la seqüència actual (per a la tercera vegada, punt 32). */
  senyors: number;
}

export type EndReason = "closed" | "blocked";

export interface GameState {
  /** Identificador de partida: 32 caràcters hexadecimals (128 bits). */
  gameId: string;
  rng: RngState;
  /** Número de versió de l'estat: puja en cada canvi publicat, també en desfer. */
  seq: number;
  /** Nombre d'accions fetes (jugar, canviar, passar). Determina a qui toca. */
  turn: number;
  /** Jugador que ha començat (guanyador del sorteig). */
  first: number;
  players: Player[];
  board: (Cell | null)[];
  /** Bossa: es roba de la cua de l'array. */
  bag: number[];
  /** Torns consecutius amb 0 punts (punt 22). */
  scoreless: number;
  last: LastAction | null;
  /** Sorteig d'inici: una fila per ronda; fitxa treta per cada jugador, o -1 si no hi participava. */
  startDraw: number[][];
  ended: EndReason | null;
  /** Empremta de l'estat anterior (16 caràcters hexadecimals); "" a l'estat inicial. */
  prevHash: string;
}
