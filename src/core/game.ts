/**
 * Motor del joc: funcions pures (estat + acció → estat nou). Sense pantalla, xarxa ni rellotge.
 * Referència: Reglament de Scrabble clàssic de l'AJUSC v1.1 (els números entre parèntesis són els punts).
 * Les decisions D-xx són a DECISIONS.md.
 */
import { CELLS, CENTER, colOf, letterMultiplier, rowOf, SIZE, wordMultiplier } from "./board";
import { stateHash } from "./codec";
import { rngFromSeed, shuffle, type RngState } from "./rng";
import { BLANK, TILE_DISTRIBUTION, TILE_LABELS, TILE_VALUES, tilesToWord, VOWELS, wordToTiles } from "./tiles";
import type { Action, Cell, GameState, Placement, Player } from "./types";

/**
 * Diu si una seqüència de fitxes és una paraula vàlida.
 * `softcatala`: la partida també accepta les paraules de Softcatalà que el DISC no té (D-37).
 */
export type IsWord = (tiles: readonly number[], softcatala: boolean) => boolean;

export type MoveError =
  | { code: "game-over" }
  | { code: "not-your-turn" }
  | { code: "not-active" }
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
  | { code: "invalid-words"; words: string[]; cells: number[] }
  | { code: "bag-too-small" }
  | { code: "bad-exchange" }
  | { code: "table-full" }
  | { code: "vote-in-progress" }
  | { code: "proposal-pending" }
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
export const MAX_ACTIVE = 4;
export const MAX_PLAYERS = 8;
const RACK_SIZE = 7;
const MAX_DRAW_ROUNDS = 15;

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;
const fail = (error: MoveError): never => { throw new EngineError(error); };

export const currentPlayer = (s: GameState) => s.current;
export const activePlayers = (s: GameState) => s.players.flatMap((p, i) => (p.status === "active" ? [i] : []));
export const rackValue = (rack: readonly number[]) => rack.reduce((a, t) => a + TILE_VALUES[t]!, 0);

const draw = (s: GameState, rack: number[], n: number) => {
  for (let i = 0; i < n && s.bag.length > 0; i++) rack.push(s.bag.pop()!);
};

/** Classificació: actius i trets per consens, de més a menys punts. Els retirats en queden fora (D-13, D-14). */
export function standings(s: GameState): number[] {
  return s.players.flatMap((p, i) => (p.status === "retired" ? [] : [i])).sort((a, b) => s.players[b]!.score - s.players[a]!.score);
}

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
    if (contenders.length === 1 || rounds.length >= MAX_DRAW_ROUNDS) return { first: contenders[0]!, rounds, drawn };
  }
}

export interface NewGame {
  gameId: string; // 32 caràcters hexadecimals
  seed: Uint8Array; // 16 bytes d'atzar real
  names: string[]; // 2 a 4 noms
  /** Acceptar també les paraules no oficials de Softcatalà (D-37). Per defecte, només el DISC. */
  softcatala?: boolean;
}

const newPlayer = (name: string, score = 0): Player => ({ name: cleanName(name), score, rack: [], senyors: 0, status: "active", fresh: true });

export function createGame({ gameId, seed, names, softcatala = false }: NewGame): GameState {
  if (!/^[0-9a-f]{32}$/.test(gameId)) throw new Error("Identificador de partida no vàlid");
  if (names.length < 2 || names.length > MAX_ACTIVE) throw new Error("Calen de 2 a 4 jugadors");
  const rng: RngState = rngFromSeed(seed);
  const bag: number[] = [];
  TILE_DISTRIBUTION.forEach((count, tile) => {
    for (let i = 0; i < count; i++) bag.push(tile);
  });
  shuffle(rng, bag);

  const draw0 = runStartDraw(names.length, () => bag.pop()!);
  bag.push(...draw0.drawn); // les fitxes del sorteig tornen a la bossa
  shuffle(rng, bag);

  const n = names.length;
  const order = Array.from({ length: n }, (_, k) => (draw0.first + k) % n);
  const s: GameState = {
    gameId, rng, seq: 0, turn: 0, first: draw0.first, initialCount: n,
    players: names.map(name => newPlayer(name)),
    order, current: draw0.first,
    board: new Array<Cell | null>(CELLS).fill(null),
    bag, scoreless: 0, removal: null, proposal: null, approvedWords: [], last: null,
    startDraw: draw0.rounds, ended: null, prevHash: "", softcatala,
  };
  for (const p of order) draw(s, s.players[p]!.rack, RACK_SIZE); // (5) en ordre de joc
  return s;
}

export function cleanName(name: string): string {
  const n = Array.from(name.trim().replace(/\s+/g, " ")).slice(0, MAX_NAME_CHARS).join("");
  if (!n) throw new Error("El nom no pot ser buit");
  return n;
}

/** Canvia el nom d'un jugador. Només el mòbil d'aquest jugador ho fa, amb la seva propera publicació. */
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

/** Valida una jugada del jugador a qui toca i calcula paraules i punts, sense modificar l'estat. */
export function checkPlay(state: GameState, placements: readonly Placement[], isWord: IsWord):
  { ok: true; result: PlayCheck } | { ok: false; error: MoveError } {
  const no = (error: MoveError) => ({ ok: false as const, error });
  if (state.ended) return no({ code: "game-over" });
  if (placements.length === 0) return no({ code: "no-tiles" });
  if (placements.length > RACK_SIZE) return no({ code: "not-in-rack" });

  const seen = new Set<number>();
  for (const p of placements) {
    if (!Number.isInteger(p.index) || p.index < 0 || p.index >= CELLS) return no({ code: "off-board" });
    if (seen.has(p.index)) return no({ code: "duplicate" });
    seen.add(p.index);
    if (state.board[p.index]) return no({ code: "occupied", index: p.index });
    const isBlank = p.tile === BLANK;
    if (isBlank ? !(p.letter >= 1 && p.letter < TILE_LABELS.length) : p.letter !== p.tile || !(p.tile >= 1 && p.tile < TILE_LABELS.length))
      return no({ code: "bad-blank" });
  }
  // Les fitxes han de ser a l'atril del jugador
  const rack = [...state.players[state.current]!.rack];
  for (const p of placements) {
    const k = rack.indexOf(p.tile);
    if (k < 0) return no({ code: "not-in-rack" });
    rack.splice(k, 1);
  }

  // Alineades en una fila o columna (10-11)
  const idx = placements.map(p => p.index).sort((a, b) => a - b);
  const sameRow = idx.every(i => rowOf(i) === rowOf(idx[0]!));
  const sameCol = idx.every(i => colOf(i) === colOf(idx[0]!));
  if (!sameRow && !sameCol) return no({ code: "not-aligned" });

  const board = state.board.slice();
  for (const p of placements) board[p.index] = { tile: p.tile, letter: p.letter };

  // Sense forats entre la primera i l'última fitxa (11)
  const step: 1 | 15 = idx.length > 1 ? (sameRow ? 1 : 15) : 1;
  for (let i = idx[0]!; i <= idx[idx.length - 1]!; i += step) if (!board[i]) return no({ code: "gap" });

  const boardEmpty = state.board.every(c => c === null);
  if (boardEmpty) {
    if (!seen.has(CENTER)) return no({ code: "first-center" }); // (9)
    if (placements.length < 2) return no({ code: "first-two" }); // (9)
  } else if (!placements.some(p => neighbours(p.index).some(n => state.board[n]))) {
    return no({ code: "not-connected" }); // (11)
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
  if (wordCells.length === 0) return no({ code: "not-connected" });

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
  // Una paraula aprovada en aquesta partida val fins al final (D-21)
  const approved = (t: number[]) => state.approvedWords.some(w => w.length === t.length && w.every((x, k) => x === t[k]));
  const invalid = words.filter(w => !isWord(w.letters, state.softcatala) && !approved(w.letters));
  if (invalid.length) {
    // Caselles de les paraules no vàlides, per marcar-les a la pantalla
    const cells = [...new Set(invalid.flatMap(w => w.cells))].sort((a, b) => a - b);
    return no({ code: "invalid-words", words: invalid.map(w => tilesToWord(w.letters)), cells });
  }

  const bingo = placements.length === RACK_SIZE;
  const score = words.reduce((a, w) => a + w.score, 0) + (bingo ? 50 : 0); // (49)
  return { ok: true, result: { words, score, bingo } };
}

// ---------------------------------------------------------------- ordre de joc i membres

/** Jugador actiu següent en l'ordre de joc. */
const nextInOrder = (s: GameState, p: number) => s.order[(s.order.indexOf(p) + 1) % s.order.length]!;
/** Jugador que juga després de qui té el torn. */
export const nextPlayer = (s: GameState) => nextInOrder(s, s.current);

/** Treu un jugador del joc: les seves fitxes tornen a la bossa, que es remena (D-13, D-14). */
function dropPlayer(s: GameState, p: number, status: "retired" | "removed"): void {
  const pl = s.players[p]!;
  if (s.current === p && s.order.length > 1) s.current = nextInOrder(s, p);
  s.order = s.order.filter(x => x !== p);
  s.bag.push(...pl.rack);
  shuffle(s.rng, s.bag);
  pl.rack = [];
  pl.status = status;
  pl.senyors = 0;
  pl.fresh = false;
  if (s.removal) {
    if (s.removal.target === p) s.removal = null;
    else s.removal.votes = s.removal.votes.filter(v => v !== p);
  }
  // Si marxa qui havia d'aprovar, l'aprovació passa al següent, que es calcula sobre l'ordre nou
  if (s.proposal?.player === p) s.proposal = null;
  s.scoreless = 0;
}

/** Qui ha d'aprovar la proposta en curs: el jugador següent en l'ordre de torns (D-21). */
export function proposalApprover(s: GameState): number | null {
  const pr = s.proposal;
  return pr && s.order.length > 1 ? nextInOrder(s, pr.player) : null;
}

/** Col·loca les fitxes d'una jugada vàlida, suma els punts i roba (19). Retorna els punts. */
function doPlay(s: GameState, actor: number, placements: readonly Placement[], isWord: IsWord): { score: number; placements: Placement[] } {
  const check = checkPlay(s, placements, isWord);
  if (!check.ok) return fail(check.error);
  const pl = s.players[actor]!;
  const sorted = [...placements].sort((a, b) => a.index - b.index).map(x => ({ index: x.index, tile: x.tile, letter: x.letter }));
  for (const x of sorted) {
    pl.rack.splice(pl.rack.indexOf(x.tile), 1);
    s.board[x.index] = { tile: x.tile, letter: x.letter };
  }
  pl.score += check.result.score;
  draw(s, pl.rack, RACK_SIZE - pl.rack.length); // (19)
  s.scoreless = 0; // una jugada vàlida fa avançar la partida, encara que valgui 0 punts (D-05)
  return { score: check.result.score, placements: sorted };
}

/** Si tots els altres actius han votat, el jugador queda tret (D-14). */
function settleRemoval(s: GameState): void {
  if (!s.removal) return;
  const { target, votes } = s.removal;
  const needed = activePlayers(s).filter(p => p !== target);
  if (needed.length > 0 && needed.every(p => votes.includes(p))) dropPlayer(s, target, "removed");
}

const minActiveScore = (s: GameState) => Math.min(...activePlayers(s).map(p => s.players[p]!.score));

/** Afegeix un jugador al final de la ronda amb 7 fitxes noves (D-15). */
function seat(s: GameState, p: number): void {
  s.order.push(p);
  draw(s, s.players[p]!.rack, RACK_SIZE);
  s.scoreless = 0;
}

// ---------------------------------------------------------------- aplicar accions

/**
 * Aplica una acció. `actor` és el jugador que la fa (per defecte, a qui toca).
 * Retorna un estat nou; llança EngineError si l'acció no és vàlida.
 */
export function applyAction(state: GameState, action: Action, isWord: IsWord, actor: number = state.current): GameState {
  if (state.ended) fail({ code: "game-over" });
  const s = clone(state);
  const pl = s.players[actor];
  if (!pl || pl.status !== "active") return fail({ code: "not-active" });
  const onTurn = () => { if (actor !== s.current) fail({ code: "not-your-turn" }); };
  let score = 0;
  let canonical: Action;
  /** Jugador la jugada, el canvi o la passada del qual fa avançar el torn. */
  let mover: number | null = null;
  let played = false;
  // Amb una proposta pendent, qui l'ha feta no pot fer res més fins que es resolgui (D-21)
  const onTurnActions = ["play", "exchange", "pass", "senyors", "join", "rejoin", "propose"];
  if (s.proposal && onTurnActions.includes(action.type)) fail({ code: "proposal-pending" });

  switch (action.type) {
    case "play": {
      onTurn();
      const done = doPlay(s, actor, action.placements, isWord);
      score = done.score;
      mover = actor;
      played = true;
      canonical = { type: "play", placements: done.placements };
      break;
    }
    case "propose": {
      onTurn();
      const check = checkPlay(s, action.placements, isWord);
      if (check.ok) fail({ code: "not-allowed" }); // és vàlida: s'ha de jugar directament
      else if (check.error.code !== "invalid-words") fail(check.error); // només per paraules, no per posició
      const placements = [...action.placements].sort((a, b) => a.index - b.index).map(x => ({ index: x.index, tile: x.tile, letter: x.letter }));
      s.proposal = { player: actor, placements };
      canonical = { type: "propose", placements };
      break;
    }
    case "approve": {
      // L'aprovació del jugador següent n'hi ha prou: les paraules s'accepten i la jugada s'aplica (D-21)
      const pr = s.proposal;
      if (!pr || proposalApprover(s) !== actor) return fail({ code: "not-allowed" });
      const check = checkPlay(s, pr.placements, isWord);
      if (!check.ok && check.error.code === "invalid-words") {
        for (const w of check.error.words) s.approvedWords.push(wordToTiles(w)!);
      }
      score = doPlay(s, pr.player, pr.placements, isWord).score;
      s.proposal = null;
      mover = pr.player;
      played = true;
      canonical = { type: "approve" };
      break;
    }
    case "reject": {
      if (!s.proposal || (s.proposal.player !== actor && proposalApprover(s) !== actor)) fail({ code: "not-allowed" });
      s.proposal = null;
      canonical = { type: "reject" };
      break;
    }
    case "exchange": {
      onTurn();
      if (s.bag.length < RACK_SIZE) fail({ code: "bag-too-small" }); // (34)
      if (action.tiles.length < 1 || action.tiles.length > RACK_SIZE) fail({ code: "bad-exchange" });
      // Ordre canònic: el resultat no pot dependre de l'ordre en què es trien les fitxes
      const tiles = [...action.tiles].sort((a, b) => a - b);
      const rack = [...pl.rack];
      for (const t of tiles) {
        const k = rack.indexOf(t);
        if (k < 0) fail({ code: "not-in-rack" });
        rack.splice(k, 1);
      }
      // (34) Primer roba les noves; després les descartades tornen a la bossa, que es remena
      draw(s, rack, tiles.length);
      s.bag.push(...tiles);
      shuffle(s.rng, s.bag);
      pl.rack = rack;
      s.scoreless += 1;
      mover = actor;
      canonical = { type: "exchange", tiles };
      break;
    }
    case "pass":
      onTurn();
      s.scoreless += 1; // (33)
      mover = actor;
      canonical = { type: "pass" };
      break;
    case "senyors":
      // Atril inicial o d'entrada: s'ofereix a l'inici del propi torn (D-03)
      onTurn();
      if (!senyorsAtTurnStart(state, actor)) fail({ code: "not-allowed" });
      doSenyorsSwap(s, actor);
      canonical = { type: "senyors" };
      break;
    case "leave":
      dropPlayer(s, actor, "retired"); // (D-13)
      canonical = { type: "leave" };
      break;
    case "vote-remove": {
      const target = action.target;
      if (target === actor || s.players[target]?.status !== "active") fail({ code: "not-allowed" });
      if (s.removal && s.removal.target !== target) fail({ code: "vote-in-progress" });
      s.removal ??= { target, votes: [] };
      if (!s.removal.votes.includes(actor)) s.removal.votes.push(actor);
      s.removal.votes.sort((a, b) => a - b);
      canonical = { type: "vote-remove", target };
      break;
    }
    case "join": {
      onTurn();
      if (activePlayers(s).length >= MAX_ACTIVE || s.players.length >= MAX_PLAYERS) fail({ code: "table-full" });
      if (s.bag.length < RACK_SIZE) fail({ code: "bag-too-small" });
      // Jugador nou: la puntuació més baixa dels actius (D-15)
      s.players.push(newPlayer(action.name, minActiveScore(s)));
      seat(s, s.players.length - 1);
      canonical = { type: "join", name: cleanName(action.name) };
      break;
    }
    case "rejoin": {
      onTurn();
      const back = s.players[action.player];
      if (!back || back.status === "active") fail({ code: "not-allowed" });
      if (activePlayers(s).length >= MAX_ACTIVE) fail({ code: "table-full" });
      if (s.bag.length < RACK_SIZE) fail({ code: "bag-too-small" });
      // Qui torna: el més alt entre els seus punts i la puntuació més baixa dels actius (D-15)
      back!.score = Math.max(back!.score, minActiveScore(s));
      back!.status = "active";
      back!.fresh = true;
      back!.senyors = 0;
      seat(s, action.player);
      canonical = { type: "rejoin", player: action.player };
      break;
    }
    default:
      return fail({ code: "not-allowed" });
  }

  // Si el jugador amenaçat de ser tret actua, la votació s'anul·la (D-14)
  if (s.removal?.target === actor) s.removal = null;
  settleRemoval(s);

  if (mover !== null) {
    const m = s.players[mover]!;
    m.senyors = 0;
    m.fresh = false;
    s.current = nextInOrder(s, mover);
  }
  s.last = { player: actor, action: canonical, score, senyorsSwaps: 0 };
  s.turn += 1;
  s.seq += 1;
  s.prevHash = stateHash(state);

  // Final de partida (22), adaptat a 2-4 jugadors
  const active = activePlayers(s);
  if (played && mover !== null && s.players[mover]!.rack.length === 0 && s.bag.length === 0) {
    s.ended = "closed";
    const closer = s.players[mover]!;
    for (const o of active) {
      if (o === mover) continue;
      const v = rackValue(s.players[o]!.rack);
      s.players[o]!.score -= v;
      closer.score += v;
    }
  } else if (active.length < 2) {
    s.ended = "abandoned"; // sense ajustos d'atril: la partida no s'ha tancat (D-16)
  } else if (s.scoreless >= 3 * active.length) {
    s.ended = "blocked";
    for (const o of active) s.players[o]!.score -= rackValue(s.players[o]!.rack);
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

const canSwap = (s: GameState, p: number) => {
  const pl = s.players[p]!;
  // Després del procediment de la tercera vegada ja no es pot tornar a canviar
  return !s.ended && pl.status === "active" && pl.senyors < 3 && s.bag.length > 0 && isSenyorsRack(pl.rack);
};

/** Oferta just després de robar, dins la mateixa publicació de la jugada o el canvi (32). */
export function senyorsAvailable(state: GameState, player: number): boolean {
  if (!state.last || state.last.player !== player) return false;
  const t = state.last.action.type;
  return (t === "play" || t === "exchange") && canSwap(state, player);
}

/** Oferta a l'inici del propi torn, amb l'atril inicial o d'entrada (D-03). */
export function senyorsAtTurnStart(state: GameState, player: number): boolean {
  return state.current === player && state.players[player]!.fresh && canSwap(state, player);
}

/** Canvi de senyors just després de robar; no canvia la versió perquè va dins la mateixa publicació. */
export function swapSenyors(state: GameState, player: number): GameState {
  if (!senyorsAvailable(state, player)) fail({ code: "not-allowed" });
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
    if (different.length === 1) {
      const keep = different[0]!;
      s.bag.splice(s.bag.indexOf(keep), 1);
      s.bag.push(...pl.rack);
      shuffle(s.rng, s.bag);
      pl.rack = [keep];
      draw(s, pl.rack, RACK_SIZE - 1);
    } else if (different.length > 1) {
      for (let guard = 0; guard < 10000; guard++) {
        s.bag.push(...pl.rack);
        shuffle(s.rng, s.bag);
        pl.rack = [];
        draw(s, pl.rack, RACK_SIZE);
        if (pl.rack.some(t => !sameKind(t))) break;
      }
    } // si tota la bossa és del mateix tipus, es queda les fitxes
  } else {
    s.bag.push(...pl.rack);
    shuffle(s.rng, s.bag);
    pl.rack = [];
    draw(s, pl.rack, RACK_SIZE);
  }
  pl.senyors += 1;
}

// ---------------------------------------------------------------- desfer i verificació

/** Pot desfer qui ha fet l'última jugada, canvi o passada. */
export function canUndo(state: GameState, player: number): boolean {
  const t = state.last?.action.type;
  return !!state.last && state.last.player === player && (t === "play" || t === "exchange" || t === "pass");
}

/** Torna a l'estat anterior com a versió nova (seq + 1), perquè els altres mòbils l'acceptin (D-01). */
export function undoState(current: GameState, previous: GameState): GameState {
  if (!current.last || !canUndo(current, current.last.player)) fail({ code: "not-allowed" });
  if (current.prevHash !== stateHash(previous)) throw new Error("L'estat anterior no correspon");
  const s = clone(previous);
  s.seq = current.seq + 1;
  s.prevHash = stateHash(current);
  s.last = { player: current.last!.player, action: { type: "undo" }, score: 0, senyorsSwaps: 0 };
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
      expected = applyAction(prev, last.action, isWord, last.player);
      for (let k = 0; k < last.senyorsSwaps; k++) expected = swapSenyors(expected, last.player);
      // Qui actua pot haver canviat el seu nom
      expected.players[last.player]!.name = next.players[last.player]?.name ?? "";
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
