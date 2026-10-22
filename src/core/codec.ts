/**
 * Serialització canònica de l'estat en bits: el mateix estat dona sempre els mateixos bytes,
 * a qualsevol navegador. D'aquí surt l'empremta (SHA-256) que encadena els estats.
 *
 * Format 1 (ordre fix dels camps; amplada en bits entre parèntesis):
 *   format(8) · gameId(128) · rng(4×32) · seq(24) · turn(16)
 *   jugadors-1(3) · inicials-2(2) · first(3) · current(3) · scoreless(5) · ended(2) · prevHash(64)
 *   ordre: n(3) + jugador(3) c/u · votació: hi ha(1) [+ objectiu(3) + vots(8, un bit per jugador)]
 *   startDraw: rondes(4), i per ronda una fitxa per jugador inicial (5; 31 = no participa)
 *   per jugador: bytes del nom UTF-8(6) + bytes · punts+32768(16) · senyors(2) · estat(2) · fresh(1)
 *                · atril: n(3) + fitxes(5 c/u)
 *   tauler: mapa d'ocupació (225), i per cada casella ocupada: escarràs(1) + fitxa(5)
 *   bossa: n(7) + fitxes(5 c/u)
 *   proposta: hi ha(1) [+ jugador(3) + n-1(3) + col·locacions(14 c/u)]
 *   paraules aprovades: n(5) + per paraula: llargada(4) + fitxes(5 c/u)
 *   última acció: tipus(4); si n'hi ha: jugador(3) · punts(13) · senyors(2) · dades segons el tipus
 *
 * Format 2 = format 1 + diccionari(8) just després del número de format (0: DISC; 1: DISC + Softcatalà).
 * Les partides només amb el DISC es continuen escrivint en format 1, byte a byte com abans:
 * així no canvien les empremtes de les partides en curs i les versions antigues de l'app hi poden jugar (D-37).
 */
import { CELLS } from "./board";
import { fromHex, sha256, toHex } from "./sha256";
import type { Action, Cell, GameState, LastAction, Player, PlayerStatus } from "./types";

export const FORMAT = 2;
const DICTIONARIES = ["disc", "disc+softcatala"] as const;

class BitWriter {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(value: number, bits: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) throw new Error(`Valor fora de rang: ${value} en ${bits} bits`);
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | (Math.floor(value / 2 ** i) & 1);
      if (++this.n === 8) { this.bytes.push(this.acc); this.acc = 0; this.n = 0; }
    }
  }
  writeBytes(b: Uint8Array): void { for (const x of b) this.write(x, 8); }
  writeText(t: string): void {
    const b = new TextEncoder().encode(t);
    this.write(b.length, 6);
    this.writeBytes(b);
  }
  finish(): Uint8Array {
    if (this.n > 0) { this.bytes.push(this.acc << (8 - this.n)); this.acc = 0; this.n = 0; }
    return new Uint8Array(this.bytes);
  }
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new Error("Dades truncades");
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  readBytes(n: number): Uint8Array { return Uint8Array.from({ length: n }, () => this.read(8)); }
  readText(): string { return new TextDecoder("utf-8", { fatal: true }).decode(this.readBytes(this.read(6))); }
  get bitsLeft(): number { return this.bytes.length * 8 - this.pos; }
}

const ENDED = [null, "closed", "blocked", "abandoned"] as const;
const STATUS: PlayerStatus[] = ["active", "retired", "removed"];
const ACTION_TYPES = ["none", "play", "exchange", "pass", "undo", "senyors", "leave", "vote-remove", "join", "rejoin", "propose", "approve", "reject"] as const;

const writePlacements = (w: BitWriter, ps: readonly { index: number; tile: number; letter: number }[]) => {
  w.write(ps.length - 1, 3);
  for (const p of ps) { w.write(p.index, 8); w.write(p.tile === 0 ? 1 : 0, 1); w.write(p.letter, 5); }
};

export function encodeState(s: GameState): Uint8Array {
  const w = new BitWriter();
  if (s.softcatala) {
    w.write(2, 8);
    w.write(DICTIONARIES.indexOf("disc+softcatala"), 8);
  } else {
    w.write(1, 8);
  }
  w.writeBytes(fromHex(s.gameId));
  for (const x of s.rng) w.write(x >>> 0, 32);
  w.write(s.seq, 24);
  w.write(s.turn, 16);
  w.write(s.players.length - 1, 3);
  w.write(s.initialCount - 2, 2);
  w.write(s.first, 3);
  w.write(s.current, 3);
  w.write(Math.min(s.scoreless, 31), 5);
  w.write(ENDED.indexOf(s.ended), 2);
  w.writeBytes(s.prevHash ? fromHex(s.prevHash) : new Uint8Array(8));

  w.write(s.order.length, 3);
  for (const p of s.order) w.write(p, 3);
  w.write(s.removal ? 1 : 0, 1);
  if (s.removal) {
    w.write(s.removal.target, 3);
    w.write(s.removal.votes.reduce((m, v) => m | (1 << v), 0), 8);
  }

  w.write(s.startDraw.length, 4);
  for (const round of s.startDraw) for (let i = 0; i < s.initialCount; i++) w.write(round[i] === -1 ? 31 : round[i]!, 5);

  for (const p of s.players) {
    w.writeText(p.name);
    w.write(p.score + 32768, 16);
    w.write(p.senyors, 2);
    w.write(STATUS.indexOf(p.status), 2);
    w.write(p.fresh ? 1 : 0, 1);
    w.write(p.rack.length, 3);
    for (const t of p.rack) w.write(t, 5);
  }

  for (let i = 0; i < CELLS; i++) w.write(s.board[i] ? 1 : 0, 1);
  for (const c of s.board) if (c) { w.write(c.tile === 0 ? 1 : 0, 1); w.write(c.letter, 5); }

  w.write(s.bag.length, 7);
  for (const t of s.bag) w.write(t, 5);

  w.write(s.proposal ? 1 : 0, 1);
  if (s.proposal) {
    w.write(s.proposal.player, 3);
    writePlacements(w, s.proposal.placements);
  }
  w.write(s.approvedWords.length, 5);
  for (const word of s.approvedWords) {
    w.write(word.length, 4);
    for (const t of word) w.write(t, 5);
  }

  const last = s.last;
  w.write(last ? ACTION_TYPES.indexOf(last.action.type) : 0, 4);
  if (last) {
    w.write(last.player, 3);
    w.write(last.score, 13);
    w.write(last.senyorsSwaps, 2);
    const a = last.action;
    if (a.type === "play" || a.type === "propose") {
      writePlacements(w, a.placements);
    } else if (a.type === "exchange") {
      w.write(a.tiles.length - 1, 3);
      for (const t of a.tiles) w.write(t, 5);
    } else if (a.type === "vote-remove") {
      w.write(a.target, 3);
    } else if (a.type === "join") {
      w.writeText(a.name);
    } else if (a.type === "rejoin") {
      w.write(a.player, 3);
    }
  }
  return w.finish();
}

export function decodeState(bytes: Uint8Array): GameState {
  const r = new BitReader(bytes);
  const bad = (what: string): never => { throw new Error(`${what} no vàlid`); };
  const format = r.read(8);
  if (format !== 1 && format !== 2) throw new Error("Format d'estat desconegut");
  let softcatala = false;
  if (format === 2) {
    const dict = DICTIONARIES[r.read(8)] ?? bad("Diccionari");
    // El format 2 només s'escriu per a partides amb Softcatalà: així cada estat té una sola codificació.
    if (dict !== "disc+softcatala") bad("Diccionari");
    softcatala = true;
  }
  const gameId = toHex(r.readBytes(16));
  const rng = [r.read(32), r.read(32), r.read(32), r.read(32)] as GameState["rng"];
  const seq = r.read(24);
  const turn = r.read(16);
  const n = r.read(3) + 1;
  const initialCount = r.read(2) + 2;
  if (initialCount > 4 || initialCount > n) bad("Nombre de jugadors");
  const first = r.read(3);
  const current = r.read(3);
  if (first >= initialCount || current >= n) bad("Jugador");
  const scoreless = r.read(5);
  const ended = ENDED[r.read(2)]!;
  const ph = r.readBytes(8);
  const prevHash = ph.every(b => b === 0) ? "" : toHex(ph);

  const order = Array.from({ length: r.read(3) }, () => r.read(3));
  if (order.some(p => p >= n) || new Set(order).size !== order.length) bad("Ordre de joc");
  let removal: GameState["removal"] = null;
  if (r.read(1)) {
    const target = r.read(3);
    const mask = r.read(8);
    if (target >= n || mask >> n) bad("Votació");
    removal = { target, votes: Array.from({ length: n }, (_, i) => i).filter(i => mask & (1 << i)) };
  }

  const rounds = r.read(4);
  const startDraw: number[][] = [];
  for (let k = 0; k < rounds; k++) startDraw.push(Array.from({ length: initialCount }, () => { const t = r.read(5); return t === 31 ? -1 : t; }));

  const tile = (allowBlank = true) => {
    const t = r.read(5);
    if (t > 26 || (!allowBlank && t === 0)) bad("Fitxa");
    return t;
  };
  const players: Player[] = [];
  for (let i = 0; i < n; i++) {
    const name = r.readText();
    const score = r.read(16) - 32768;
    const senyors = r.read(2);
    const status = STATUS[r.read(2)] ?? bad("Estat de jugador");
    const fresh = r.read(1) === 1;
    const rackLen = r.read(3);
    if (rackLen > 7) bad("Atril");
    const rack = Array.from({ length: rackLen }, () => tile());
    players.push({ name, score, rack, senyors, status, fresh });
  }
  if (order.some(p => players[p]!.status !== "active")) bad("Ordre de joc");

  const occupied = Array.from({ length: CELLS }, () => r.read(1) === 1);
  const board: (Cell | null)[] = occupied.map(o => {
    if (!o) return null;
    const blank = r.read(1) === 1;
    const letter = tile(false);
    return { tile: blank ? 0 : letter, letter };
  });

  const bagLen = r.read(7);
  if (bagLen > 100) bad("Bossa");
  const bag = Array.from({ length: bagLen }, () => tile());

  const readPlacements = () => Array.from({ length: r.read(3) + 1 }, () => {
    const index = r.read(8);
    if (index >= CELLS) bad("Casella");
    const blank = r.read(1) === 1;
    const letter = tile(false);
    return { index, tile: blank ? 0 : letter, letter };
  });
  let proposal: GameState["proposal"] = null;
  if (r.read(1)) {
    const player = r.read(3);
    if (player >= n) bad("Proposta");
    proposal = { player, placements: readPlacements() };
  }
  const approvedWords = Array.from({ length: r.read(5) }, () => Array.from({ length: r.read(4) }, () => tile(false)));

  let last: LastAction | null = null;
  const type = ACTION_TYPES[r.read(4)] ?? bad("Acció");
  if (type !== "none") {
    const player = r.read(3);
    if (player >= n) bad("Jugador");
    const score = r.read(13);
    const senyorsSwaps = r.read(2);
    let action: LastAction["action"];
    if (type === "play") {
      action = { type: "play", placements: readPlacements() } satisfies Action;
    } else if (type === "propose") {
      action = { type, placements: readPlacements() };
    } else if (type === "exchange") {
      const count = r.read(3) + 1;
      action = { type: "exchange", tiles: Array.from({ length: count }, () => tile()) };
    } else if (type === "vote-remove") {
      action = { type, target: r.read(3) };
    } else if (type === "join") {
      action = { type, name: r.readText() };
    } else if (type === "rejoin") {
      action = { type, player: r.read(3) };
    } else {
      action = { type };
    }
    last = { player, action, score, senyorsSwaps };
  }
  if (r.bitsLeft >= 8) throw new Error("Dades sobrants");

  return { gameId, rng, seq, turn, first, initialCount, players, order, current, board, bag, scoreless, removal, proposal, approvedWords, last, startDraw, ended, prevHash, softcatala };
}

/** Empremta d'un estat: els 8 primers bytes del SHA-256 de la seva forma canònica, en hexadecimal. */
export function stateHash(s: GameState): string {
  return toHex(sha256(encodeState(s)).subarray(0, 8));
}
