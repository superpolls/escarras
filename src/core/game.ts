/**
 * Motor del joc: funcions pures (estat + acció → estat nou). Sense pantalla, xarxa ni rellotge.
 * Referència: Reglament de Scrabble clàssic de l'AJUSC v1.1 (els números entre parèntesis són els punts).
 */
import { CELLS, CENTER, colOf, letterMultiplier, rowOf, SIZE, wordMultiplier } from "./board";
import { stateHash } from "./codec";
import { rngFromSeed, shuffle, type RngState } from "./rng";
import { BLANK, TILE_DISTRIBUTION, TILE_LABELS, TILE_VALUES, tilesToWord, VOWELS } from "./tiles";
import type { Action, Cell, GameState, Placement } from "./types";

export type IsWord = (tiles: readonly number[]) => boolean;

export type MoveError =
  | { code: "game-over" }
  | { code: "no-tiles" }
  | { code: "off-board" }
  | { code: "duplicate" }
  | { code: "occupied"; index: number }
  | { code: "not-in-rack" }
  | { code: "bad-blank" }
  | { code: "not-aligned" }
  | { code: "gap" }
  | { code: "first-center" }
  | { code: "first-two" }
  | { code: "not-connected" }
  | { code: "invalid-words"; words: string[] }
  | { code: "bag-too-small" }
  | { code: "bad-exchange" }
  | { code: "not-allowed" };

export class EngineError extends Error {
  constructor(readonly error: MoveError) {
    super(error.code);
  }
}

export interface Word {
  cells: number[];
  letters: number[];
  score: number;
}

export interface PlayCheck {
  words: Word[];
  score: number;
  bingo: boolean;
}

export const MAX_NAME_CHARS = 12;
const RACK_SIZE = 7;
const MAX_DRAW_ROUNDS = 15;

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

export const currentPlayer = (s: GameState) => (s.first + s.turn) % s.players.length;

export const rackValue = (rack: readonly number[]) => rack.reduce((a, t) => a + TILE_VALUES[t]!, 0);

const draw = (s: GameState, rack: number[], n: number) => {
  for (let i = 0; i < n && s.bag.length > 0; i++) rack.push(s.bag.pop()!);
};

// ---------------------------------------------------------------- creació i sorteig (3, 5)

/**
 * Sorteig d'inici (3): cada jugador treu una fitxa; comença qui treu la més propera al principi
 * de l'alfabet (escarràs < A < … < C < Ç < … < L < L·L < … < N < NY < … < Z). Els empatats repeteixen.
 * Els identificadors de fitxa ja segueixen aquest ordre.
 */
export function runStartDraw(n: number, drawTile: () => number): { first: number; rounds: number[][]; drawn: number[] } {
  let contenders = Array.from({ length: n }, (_, i) => i);
  const rounds: number[][] = [];
  const drawn: number[] = [];
  for (;;) {
    const row = new Array<number>(n).fill(-1);
    for (const c of contenders) {
      row[c] = drawTile();
      drawn.push(row[c]!);
    }
    rounds.push(row);
    const best = Math.min(...contenders.map(c => row[c]!));
    contenders = contenders.filter(c => row[c] === best);
    if (contenders.length === 1) return { first: contenders[0]!, rounds, drawn };
    if (rounds.length >= MAX_DRAW_ROUNDS) return { first: contenders[0]!, rounds, drawn }; // pràcticament impossible
  }
}

export interface NewGame {
  gameId: string; // 32 caràcters hexadecimals
  seed: Uint8Array; // 16 bytes d'atzar real
  names: string[]; // 2 a 4 noms
}

export function createGame({ gameId, seed, names }: NewGame): GameState {
  if (!/^[0-9a-f]{32}$/.test(gameId)) throw new Error("Identificador de partida no vàlid");
  if (names.length < 2 || names.length > 4) throw new Error("Calen de 2 a 4 jugadors");
  const rng: RngState = rngFromSeed(seed);
  const bag: number[] = [];
  TILE_DISTRIBUTION.forEach((count, tile) => {
    for (let i = 0; i < count; i++) bag.push(tile);
  });
  shuffle(rng, bag);

  const draw0 = runStartDraw(names.length, () => bag.pop()!);
  bag.push(...draw0.drawn); // les fitxes del sorteig tornen a la bossa
  shuffle(rng, bag);

  const s: GameState = {
    gameId,
    rng,
    seq: 0,
    turn: 0,
    first: draw0.first,
    players: names.map(name => ({ name: cleanName(name), score: 0, rack: [], senyors: 0 })),
    board: new Array<Cell | null>(CELLS).fill(null),
    bag,
    scoreless: 0,
    last: null,
    startDraw: draw0.rounds,
    ended: null,
    prevHash: "",
  };
  // Cada jugador roba 7 fitxes, en ordre de joc (5)
  for (let k = 0; k < names.length; k++) draw(s, s.players[(s.first + k) % names.length]!.rack, RACK_SIZE);
  // Senyors a l'atril inicial: es canvien automàticament (decisió D-03)
  for (let k = 0; k < names.length; k++) {
    const p = (s.first + k) % names.length;
    while (isSenyorsRack(s.players[p]!.rack) && s.bag.length > 0) {
      const third = s.players[p]!.senyors >= 2;
      doSenyorsSwap(s, p);
      if (third) break;
    }
    s.players[p]!.senyors = 0;
  }
  return s;
}

export function cleanName(name: string): string {
  const n = Array.from(name.trim().replace(/\s+/g, " ")).slice(0, MAX_NAME_CHARS).join("");
  if (!n) throw new Error("El nom no pot ser buit");
  return n;
}

/** Canvia el nom d'un jugador. Només el mòbil d'aquest jugador ho fa, abans de publicar. */
export function renamePlayer(state: GameState, player: number, name: string): GameState {
  const s = clone(state);
  const p = s.players[player];
  if (!p) throw new Error("Jugador inexistent");
  p.name = cleanName(name);
  return s;
}

// ---------------------------------------------------------------- jugades (9-15) i puntuació (46-49)

/** Recull la paraula que passa per `index` en una direcció (1 = horitzontal, 15 = vertical). */
function wordThrough(board: (Cell | null)[], index: number, step: 1 | 15): number[] {
  const sameLine = (a: number, b: number) => (step === 1 ? rowOf(a) === rowOf(b) : true);
  let start = index;
  while (start - step >= 0 && sameLine(start - step, index) && board[start - step]) start -= step;
  const cells: number[] = [];
  for (let i = start; i < CELLS && sameLine(i, index) && board[i]; i += step) cells.push(i);
  return cells;
}

function neighbours(i: number): number[] {
  const out: number[] = [];
  if (rowOf(i) > 0) out.push(i - SIZE);
  if (rowOf(i) < SIZE - 1) out.push(i + SIZE);
  if (colOf(i) > 0) out.push(i - 1);
  if (colOf(i) < SIZE - 1) out.push(i + 1);
  return out;
}

/** Valida una jugada i calcula paraules i punts, sense modificar l'estat. */
export function checkPlay(state: GameState, placements: readonly Placement[], isWord: IsWord):
  { ok: true; result: PlayCheck } | { ok: false; error: MoveError } {
  const fail = (error: MoveError) => ({ ok: false as const, error });
  if (state.ended) return fail({ code: "game-over" });
  if (placements.length === 0) return fail({ code: "no-tiles" });
  if (placements.length > RACK_SIZE) return fail({ code: "not-in-rack" });

  const seen = new Set<number>();
  for (const p of placements) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= CELLS) return fail({ code: "off-board" });
    if (seen.has(p.index)) return fail({ code: "duplicate" });
    seen.add(p.index);
    if (state.board[p.index]) return fail({ code: "occupied", index: p.index });
    const isBlank = p.tile === BLANK;
    if (isBlank ? !(p.letter >= 1 && p.letter < TILE_LABELS.length) : p.letter !== p.tile || !(p.tile >= 1 && p.tile < TILE_LABELS.length))
      return fail({ code: "bad-blank" });
  }
  // Les fitxes han de ser a l'atril del jugador
  const rack = [...state.players[currentPlayer(state)]!.rack];
  for (const p of placements) {
    const k = rack.indexOf(p.tile);
    if (k < 0) return fail({ code: "not-in-rack" });
    rack.splice(k, 1);
  }

  // Alineades en una fila o columna (10-11)
  const idx = placements.map(p => p.index).sort((a, b) => a - b);
  const sameRow = idx.every(i => rowOf(i) === rowOf(idx[0]!));
  const sameCol = idx.every(i => colOf(i) === colOf(idx[0]!));
  if (!sameRow && !sameCol) return fail({ code: "not-aligned" });

  const board = state.board.slice();
  for (const p of placements) board[p.index] = { tile: p.tile, letter: p.letter };

  // Sense forats entre la primera i l'última fitxa (11)
  const step: 1 | 15 = idx.length > 1 ? (sameRow ? 1 : 15) : 1;
  for (let i = idx[0]!; i <= idx[idx.length - 1]!; i += step) if (!board[i]) return fail({ code: "gap" });

  const boardEmpty = state.board.every(c => c === null);
  if (boardEmpty) {
    if (!seen.has(CENTER)) return fail({ code: "first-center" }); // (9)
    if (placements.length < 2) return fail({ code: "first-two" }); // (9)
  } else if (!placements.some(p => neighbours(p.index).some(n => state.board[n]))) {
    return fail({ code: "not-connected" }); // (11)
  }

  // Paraules formades: la principal i les creuades (11-12)
  const wordCells: number[][] = [];
  const dirs: (1 | 15)[] = idx.length > 1 ? [step] : [1, 15];
  for (const d of dirs) {
    const w = wordThrough(board, idx[0]!, d);
    if (w.length >= 2) wordCells.push(w);
  }
  if (idx.length > 1) {
    const cross: 1 | 15 = step === 1 ? 15 : 1;
    for (const i of idx) {
      const w = wordThrough(board, i, cross);
      if (w.length >= 2) wordCells.push(w);
    }
  }
  if (wordCells.length === 0) return fail({ code: "not-connected" });

  const words: Word[] = wordCells.map(cells => {
    let sum = 0;
    let mult = 1;
    for (const c of cells) {
      const cell = board[c]!;
      const isNew = seen.has(c);
      sum += TILE_VALUES[cell.tile]! * (isNew ? letterMultiplier(c) : 1); // (46, 48)
      if (isNew) mult *= wordMultiplier(c); // (46-48)
    }
    return { cells, letters: cells.map(c => board[c]!.letter), score: sum * mult };
  });
  const invalid = words.filter(w => !isWord(w.letters)).map(w => tilesToWord(w.letters));
  if (invalid.length) return fail({ code: "invalid-words", words: invalid });

  const bingo = placements.length === RACK_SIZE;
  const score = words.reduce((a, w) => a + w.score, 0) + (bingo ? 50 : 0); // (49)
  return { ok: true, result: { words, score, bingo } };
}

/** Aplica una acció del jugador a qui toca. Retorna un estat nou; llança EngineError si no és vàlida. */
export function applyAction(state: GameState, action: Action, isWord: IsWord): GameState {
  if (state.ended) throw new EngineError({ code: "game-over" });
  const s = clone(state);
  const p = currentPlayer(s);
  const pl = s.players[p]!;
  let score = 0;
  let canonical: Action;

  if (action.type === "play") {
    const check = checkPlay(state, action.placements, isWord);
    if (!check.ok) throw new EngineError(check.error);
    const placements = [...action.placements].sort((a, b) => a.index - b.index).map(x => ({ index: x.index, tile: x.tile, letter: x.letter }));
    for (const x of placements) {
      pl.rack.splice(pl.rack.indexOf(x.tile), 1);
      s.board[x.index] = { tile: x.tile, letter: x.letter };
    }
    score = check.result.score;
    pl.score += score;
    draw(s, pl.rack, RACK_SIZE - pl.rack.length); // (19)
    canonical = { type: "play", placements };
  } else if (action.type === "exchange") {
    if (s.bag.length < RACK_SIZE) throw new EngineError({ code: "bag-too-small" }); // (34)
    if (action.tiles.length < 1 || action.tiles.length > RACK_SIZE) throw new EngineError({ code: "bad-exchange" });
    const rack = [...pl.rack];
    for (const t of action.tiles) {
      const k = rack.indexOf(t);
      if (k < 0) throw new EngineError({ code: "not-in-rack" });
      rack.splice(k, 1);
    }
    // (34) Primer roba les noves; després les descartades tornen a la bossa, que es remena
    draw(s, rack, action.tiles.length);
    s.bag.push(...action.tiles);
    shuffle(s.rng, s.bag);
    pl.rack = rack;
    canonical = { type: "exchange", tiles: [...action.tiles].sort((a, b) => a - b) };
  } else if (action.type === "pass") {
    canonical = { type: "pass" }; // (33)
  } else {
    throw new EngineError({ code: "not-allowed" });
  }

  pl.senyors = 0;
  s.scoreless = score > 0 ? 0 : s.scoreless + 1;
  s.last = { player: p, action: canonical, score, senyorsSwaps: 0 };
  s.turn += 1;
  s.seq += 1;
  s.prevHash = stateHash(state);

  // Final de partida (22), adaptat a 2-4 jugadors
  if (action.type === "play" && pl.rack.length === 0 && s.bag.length === 0) {
    s.ended = "closed";
    for (const [i, o] of s.players.entries()) {
      if (i === p) continue;
      const v = rackValue(o.rack);
      o.score -= v;
      pl.score += v;
    }
  } else if (s.scoreless >= 3 * s.players.length) {
    s.ended = "blocked";
    for (const o of s.players) o.score -= rackValue(o.rack);
  }
  return s;
}

// ---------------------------------------------------------------- regla dels senyors (32)

/** Set vocals o set consonants, sense cap escarràs. Supòsit: QU és consonant. */
export function isSenyorsRack(rack: readonly number[]): boolean {
  if (rack.length !== RACK_SIZE || rack.includes(BLANK)) return false;
  const v = rack.filter(t => VOWELS.has(t)).length;
  return v === 0 || v === RACK_SIZE;
}

/** El jugador pot canviar per senyors: just després de robar (jugada o canvi) i si queda alguna fitxa a la bossa. */
export function senyorsAvailable(state: GameState, player: number): boolean {
  if (state.ended || !state.last || state.last.player !== player) return false;
  const t = state.last.action.type;
  if (t !== "play" && t !== "exchange") return false;
  const pl = state.players[player]!;
  // Després del procediment de la tercera vegada ja no es pot tornar a canviar
  return pl.senyors < 3 && state.bag.length > 0 && isSenyorsRack(pl.rack);
}

export function swapSenyors(state: GameState, player: number): GameState {
  if (!senyorsAvailable(state, player)) throw new EngineError({ code: "not-allowed" });
  const s = clone(state);
  doSenyorsSwap(s, player);
  s.last!.senyorsSwaps += 1;
  return s;
}

function doSenyorsSwap(s: GameState, player: number): void {
  const pl = s.players[player]!;
  const vowelRack = VOWELS.has(pl.rack[0]!);
  const sameKind = (t: number) => t !== BLANK && VOWELS.has(t) === vowelRack;

  if (pl.senyors >= 2) {
    // Tercera vegada consecutiva: procediment especial (32)
    const different = s.bag.filter(t => !sameKind(t));
    if (different.length === 0) {
      // Tota la bossa és del mateix tipus: es queda les fitxes
    } else if (different.length === 1) {
      const keep = different[0]!;
      s.bag.splice(s.bag.indexOf(keep), 1);
      s.bag.push(...pl.rack);
      shuffle(s.rng, s.bag);
      pl.rack = [keep];
      draw(s, pl.rack, RACK_SIZE - 1);
    } else {
      for (let guard = 0; guard < 10000; guard++) {
        s.bag.push(...pl.rack);
        shuffle(s.rng, s.bag);
        pl.rack = [];
        draw(s, pl.rack, RACK_SIZE);
        if (pl.rack.some(t => !sameKind(t))) break;
      }
    }
  } else {
    s.bag.push(...pl.rack);
    shuffle(s.rng, s.bag);
    pl.rack = [];
    draw(s, pl.rack, RACK_SIZE);
  }
  pl.senyors += 1;
}

// ---------------------------------------------------------------- desfer i verificació

/** Pot desfer qui ha fet l'última acció, si no és ja un desfer. */
export function canUndo(state: GameState, player: number): boolean {
  return !!state.last && state.last.player === player && state.last.action.type !== "undo";
}

/** Torna a l'estat anterior com a versió nova (seq + 1), perquè els altres mòbils l'acceptin. */
export function undoState(current: GameState, previous: GameState): GameState {
  if (!current.last || current.last.action.type === "undo") throw new EngineError({ code: "not-allowed" });
  if (current.prevHash !== stateHash(previous)) throw new Error("L'estat anterior no correspon");
  const s = clone(previous);
  s.seq = current.seq + 1;
  s.prevHash = stateHash(current);
  s.last = { player: current.last.player, action: { type: "undo" }, score: 0, senyorsSwaps: 0 };
  return s;
}

export type Verification = { ok: true; replayed: boolean } | { ok: false; reason: string };

/**
 * Comprova que `next` és el successor legítim de `prev`: mateixa cadena d'empremtes i,
 * repetint l'acció amb el motor propi, exactament el mateix resultat.
 * `history` permet verificar un desfer (cal l'estat anterior a `prev`).
 */
export function verifyTransition(prev: GameState, next: GameState, isWord: IsWord, history: readonly GameState[] = []): Verification {
  if (next.gameId !== prev.gameId) return { ok: false, reason: "altra partida" };
  if (next.seq !== prev.seq + 1) return { ok: false, reason: "no és la versió següent" };
  if (next.prevHash !== stateHash(prev)) return { ok: false, reason: "no ve d'aquest estat" };
  const last = next.last;
  if (!last) return { ok: false, reason: "sense acció" };
  let expected: GameState;
  try {
    if (last.action.type === "undo") {
      const before = history.find(h => stateHash(h) === prev.prevHash);
      if (!before) return { ok: true, replayed: false };
      expected = undoState(prev, before);
    } else {
      if (last.player !== currentPlayer(prev)) return { ok: false, reason: "no era el seu torn" };
      expected = applyAction(prev, last.action, isWord);
      for (let k = 0; k < last.senyorsSwaps; k++) expected = swapSenyors(expected, last.player);
      // El jugador que ha jugat pot haver canviat el seu nom
      expected.players[last.player]!.name = next.players[last.player]!.name;
    }
  } catch (e) {
    return { ok: false, reason: e instanceof EngineError ? `acció no vàlida (${e.error.code})` : String(e) };
  }
  return stateHash(expected) === stateHash(next) ? { ok: true, replayed: true } : { ok: false, reason: "el resultat no coincideix" };
}

/** Comptatge de fitxes: sempre 100 en total i la distribució oficial (tauler + atrils + bossa). */
export function tileInventoryOk(s: GameState): boolean {
  const counts = new Array<number>(TILE_DISTRIBUTION.length).fill(0);
  for (const c of s.board) if (c) counts[c.tile]! += 1;
  for (const p of s.players) for (const t of p.rack) counts[t]! += 1;
  for (const t of s.bag) counts[t]! += 1;
  return counts.every((c, i) => c === TILE_DISTRIBUTION[i]);
}

