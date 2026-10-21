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

/**
 * Accions. Qui les pot fer (D-12):
 * - play, exchange, pass, senyors, join, rejoin, propose: el mòbil de qui té el torn.
 * - leave, vote-remove: el mòbil del jugador que actua, en qualsevol moment.
 * - approve, reject: el mòbil del jugador següent (o el de qui ha proposat, per retirar-la).
 */
export type Action =
  | { type: "play"; placements: Placement[] }
  | { type: "exchange"; tiles: number[] }
  | { type: "pass" }
  /** Canvi de senyors a l'inici del propi torn, amb l'atril inicial o d'entrada (D-03). */
  | { type: "senyors" }
  /** Abandonar la partida voluntàriament (D-13). */
  | { type: "leave" }
  /** Vot per treure un jugador absent; cal el vot de tots els altres actius (D-14). */
  | { type: "vote-remove"; target: number }
  /** Acceptar un jugador nou (D-15). */
  | { type: "join"; name: string }
  /** Acceptar el retorn d'un jugador retirat o tret (D-15). */
  | { type: "rejoin"; player: number }
  /** Proposar una jugada amb paraules que el diccionari no té, perquè l'aprovi el jugador següent (D-21). */
  | { type: "propose"; placements: Placement[] }
  /** Aprovar la jugada proposada: s'aplica tot seguit (D-21). */
  | { type: "approve" }
  /** Rebutjar la jugada proposada, o retirar-la qui l'ha proposat (D-21). */
  | { type: "reject" };

/** Jugada pendent d'aprovació. L'aprova (o la rebutja) el jugador següent en l'ordre de torns (D-21). */
export interface Proposal {
  player: number;
  placements: Placement[];
}

export interface LastAction {
  player: number;
  action: Action | { type: "undo" };
  score: number;
  /** Canvis de «senyors» fets just després de robar, dins la mateixa publicació (punt 32). */
  senyorsSwaps: number;
}

/** active: juga · retired: ha abandonat (fora de classificació) · removed: tret per consens (conserva punts i classificació). */
export type PlayerStatus = "active" | "retired" | "removed";

export interface Player {
  name: string;
  score: number;
  rack: number[];
  /** Canvis de senyors consecutius en la seqüència actual (per a la tercera vegada, punt 32). */
  senyors: number;
  status: PlayerStatus;
  /** Encara no ha actuat amb l'atril rebut en començar o en entrar (per oferir-li els senyors). */
  fresh: boolean;
}

export type EndReason = "closed" | "blocked" | "abandoned";

export interface GameState {
  /** Identificador de partida: 32 caràcters hexadecimals (128 bits). */
  gameId: string;
  rng: RngState;
  /** Versió de l'estat: puja en cada canvi publicat, també en desfer (D-01). */
  seq: number;
  /** Nombre d'accions fetes. */
  turn: number;
  /** Jugador que va guanyar el sorteig d'inici. */
  first: number;
  /** Jugadors que van començar la partida (per al sorteig). */
  initialCount: number;
  players: Player[];
  /** Ordre de joc dels jugadors actius; el primer és qui obre cada ronda. */
  order: number[];
  /** Jugador a qui toca. */
  current: number;
  board: (Cell | null)[];
  /** Bossa: es roba de la cua de l'array. */
  bag: number[];
  /** Torns consecutius passant o canviant (punt 22, D-05). */
  scoreless: number;
  /** Votació en curs per treure un jugador absent. */
  removal: { target: number; votes: number[] } | null;
  /** Jugada pendent d'aprovació (D-21). */
  proposal: Proposal | null;
  /** Paraules aprovades en aquesta partida: valen fins al final (D-21). */
  approvedWords: number[][];
  last: LastAction | null;
  /** Sorteig d'inici: una fila per ronda; fitxa treta per cada jugador inicial, o -1 si no hi participava. */
  startDraw: number[][];
  ended: EndReason | null;
  /** Empremta de l'estat anterior (16 caràcters hexadecimals); "" a l'estat inicial. */
  prevHash: string;
}
