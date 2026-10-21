/**
 * Rèplica: el que sap un mòbil de la partida, i com integra una versió que li arriba per QR o pel servidor.
 * Funcions pures i síncrones: el mateix codi decideix igual per als dos canals (encàrrec 5.4 i 5.7).
 *
 * Regles (D-23):
 *  - La versió és la següent de la meva → es repeteix l'acció amb el motor propi i ha de coincidir.
 *  - En falten de pel mig → les empremtes dels avantpassats han d'incloure la meva versió.
 *  - Bifurcació → guanya la branca amb la versió més alta; a igual versió, una jugada guanya a un vot
 *    o un abandonament, i aquests a un desfer; si encara empaten, guanya el servidor (en línia) o tria
 *    la gent (QR). Si les dues versions només difereixen en qui ha fet l'acció, es tria sempre la mateixa.
 *  - Qui perd torna a aplicar les seves accions sobre la guanyadora (rebase) mentre siguin vàlides;
 *    un desfer, o la primera acció que ja no és vàlida, atura el rebase.
 */
import { decodeState, encodeState, stateHash } from "../core/codec";
import { applyAction, EngineError, senyorsAvailable, swapSenyors, verifyTransition, type IsWord } from "../core/game";
import type { GameState, LastAction } from "../core/types";
import { fromB64u, toB64u } from "./bytes";
import type { Packet } from "./packet";

/** Versions que guarda cada mòbil (per desfer, verificar i fer rebase). */
export const HISTORY = 64;
/** Avantpassats que van al QR (cada un, 4 bytes) i al servidor. */
export const QR_ANCESTORS = 8;
export const SERVER_ANCESTORS = 32;

export interface Replica {
  /** Clau de la partida (16 bytes): sala i xifratge en línia. */
  key: Uint8Array;
  /** Jugadors que porta aquest mòbil. */
  seats: number[];
  /** Línia de versions que coneix aquest mòbil, de més antiga a més nova (pot tenir forats). */
  states: GameState[];
  /** Empremta curta de cada versió de la línia, inclosos els avantpassats rebuts. */
  known: Map<number, string>;
}

export const short = (s: GameState) => stateHash(s).slice(0, 8);
export const headOf = (r: Replica) => r.states[r.states.length - 1]!;

export function newReplica(key: Uint8Array, state: GameState, seats: number[]): Replica {
  return { key, seats: [...seats].sort((a, b) => a - b), states: [state], known: new Map([[state.seq, short(state)]]) };
}

/** Estat anterior a l'actual (per desfer), si aquest mòbil el té. */
export function previousOf(r: Replica): GameState | null {
  const h = headOf(r);
  return r.states.find(s => s.seq === h.seq - 1 && stateHash(s) === h.prevHash) ?? null;
}

export function ancestorsOf(r: Replica, n: number): string[] {
  const h = headOf(r);
  const out: string[] = [];
  for (let k = 1; k <= n && h.seq - k >= 0; k++) out.push(r.known.get(h.seq - k) ?? "");
  return out;
}

export function packetOf(r: Replica, opts: { ancestors: number; key?: boolean; seat?: number | null }): Packet {
  return { state: headOf(r), ancestors: ancestorsOf(r, opts.ancestors), key: opts.key ? r.key : null, seat: opts.seat ?? null };
}

function withVersions(r: Replica, keepUpTo: number, added: GameState[], ancestors: Map<number, string>): Replica {
  const states = [...r.states.filter(s => s.seq <= keepUpTo), ...added].slice(-HISTORY);
  const known = new Map([...r.known].filter(([seq]) => seq <= keepUpTo));
  for (const [seq, h] of ancestors) known.set(seq, h);
  for (const s of added) known.set(s.seq, short(s));
  return { ...r, states, known };
}

/** Afegeix una versió feta en aquest mòbil. */
export function commitLocal(r: Replica, next: GameState): Replica {
  const h = headOf(r);
  if (next.gameId !== h.gameId || next.seq !== h.seq + 1) throw new Error("La versió no segueix la de la rèplica");
  return withVersions(r, h.seq, [next], new Map());
}

// ---------------------------------------------------------------- prioritat i equivalència

const OFF_TURN = new Set(["leave", "vote-remove", "reject"]);

/** Pes de l'última acció per desempatar bifurcacions de la mateixa versió. */
export function priority(s: GameState): number {
  const t = s.last?.action.type;
  if (!t) return -1;
  if (t === "undo") return 0;
  return OFF_TURN.has(t) ? 1 : 2;
}

/** Mateix contingut de partida, encara que l'acció l'hagi feta un altre (p. ex., dos rebutjos de la mateixa proposta). */
const equivalent = (a: GameState, b: GameState) => stateHash({ ...a, last: null }) === stateHash({ ...b, last: null });

// ---------------------------------------------------------------- rebre una versió

export type Outcome =
  | { kind: "foreign" }
  | { kind: "invalid"; reason: string }
  | { kind: "same" }
  /** La rebuda és més antiga i ja és a la meva línia (o no es pot saber): no canvia res. */
  | { kind: "older" }
  | { kind: "advanced"; verified: "replay" | "chain" | "unchecked" }
  /** Bifurcació guanyada per la rebuda: s'adopta i es tornen a aplicar les accions pròpies. */
  | { kind: "merged"; applied: LastAction[]; dropped: LastAction[] }
  /** Bifurcació guanyada per la meva: els altres han d'adoptar la meva. */
  | { kind: "kept" }
  /** Mateixa versió, dues jugades igual de vàlides: decideix la gent. */
  | { kind: "conflict"; theirs: GameState };

export interface Received { replica: Replica; outcome: Outcome }

/** Empremta curta de la línia rebuda a la versió `seq` (o undefined si el paquet no ho diu). */
function incomingAt(p: Packet, seq: number): string | undefined {
  const s = p.state;
  if (seq === s.seq) return short(s);
  if (seq === s.seq - 1 && s.prevHash) return s.prevHash.slice(0, 8);
  const h = p.ancestors[s.seq - 1 - seq];
  return h ? h : undefined;
}

/**
 * Integra una versió rebuda. `arbiter`: la versió ve del servidor, que decideix els empats.
 * `mine`: quins jugadors porta aquest mòbil (per saber quines accions ha de tornar a aplicar).
 */
export function receive(r: Replica, p: Packet, isWord: IsWord, arbiter: boolean): Received {
  const L = headOf(r);
  const I = p.state;
  const same = (outcome: Outcome): Received => ({ replica: r, outcome });
  if (I.gameId !== L.gameId) return same({ kind: "foreign" });
  const hL = short(L);
  const hI = short(I);
  const ancestors = new Map<number, string>();
  p.ancestors.forEach((h, k) => { if (h) ancestors.set(I.seq - 1 - k, h); });
  if (I.prevHash) ancestors.set(I.seq - 1, I.prevHash.slice(0, 8));

  if (I.seq < L.seq) {
    const mineThere = r.known.get(I.seq);
    if (mineThere === undefined || mineThere === hI) return same({ kind: "older" });
    return same({ kind: "kept" }); // bifurcació: la meva branca és més llarga
  }

  if (I.seq === L.seq) {
    if (hI === hL) return same({ kind: "same" });
    let incomingWins: boolean;
    if (arbiter) incomingWins = true; // en línia, el servidor ja ha decidit qui va arribar primer
    else if (equivalent(I, L)) incomingWins = hI < hL;
    else if (priority(I) !== priority(L)) incomingWins = priority(I) > priority(L);
    else if (arbiter) incomingWins = true;
    else return same({ kind: "conflict", theirs: I });
    return incomingWins ? merge(r, p, ancestors, isWord) : same({ kind: "kept" });
  }

  // La rebuda és més nova
  if (I.seq === L.seq + 1 && I.prevHash.slice(0, 8) === hL) {
    const v = verifyTransition(L, I, isWord, r.states);
    if (!v.ok) return same({ kind: "invalid", reason: v.reason });
    return { replica: withVersions(r, L.seq, [I], ancestors), outcome: { kind: "advanced", verified: v.replayed ? "replay" : "chain" } };
  }
  const theirsAtMine = incomingAt(p, L.seq);
  if (theirsAtMine === undefined) {
    return { replica: withVersions(r, L.seq, [I], ancestors), outcome: { kind: "advanced", verified: "unchecked" } };
  }
  if (theirsAtMine === hL) {
    return { replica: withVersions(r, L.seq, [I], ancestors), outcome: { kind: "advanced", verified: "chain" } };
  }
  return merge(r, p, ancestors, isWord);
}

/** La rebuda guanya una bifurcació: s'adopta i es tornen a aplicar les accions d'aquest mòbil. */
function merge(r: Replica, p: Packet, ancestors: Map<number, string>, isWord: IsWord): Received {
  const I = p.state;
  // Punt de bifurcació: la versió més alta on les dues línies coincideixen
  let fork = -1;
  for (let seq = Math.min(headOf(r).seq, I.seq - 1); seq >= 0; seq--) {
    const theirs = incomingAt(p, seq);
    if (theirs === undefined) { fork = seq; break; } // més enllà del que diu el paquet: se suposa comú
    if (r.known.get(seq) === theirs) { fork = seq; break; }
  }
  const divergent = r.states.filter(s => s.seq > fork);
  const mine = new Set(r.seats);
  const rb = rebase(I, divergent, p => mine.has(p), isWord);
  return {
    replica: withVersions(r, fork, [I, ...rb.versions], ancestors),
    outcome: { kind: "merged", applied: rb.applied, dropped: rb.dropped },
  };
}

export interface Rebased { versions: GameState[]; applied: LastAction[]; dropped: LastAction[] }

/** Torna a aplicar, sobre `base`, les accions dels jugadors indicats que hi ha a `divergent`. */
export function rebase(base: GameState, divergent: readonly GameState[], isMine: (player: number) => boolean, isWord: IsWord): Rebased {
  let cur = base;
  const versions: GameState[] = [];
  const applied: LastAction[] = [];
  const dropped: LastAction[] = [];
  let stopped = false;
  for (const v of divergent) {
    const L = v.last;
    if (!L || !isMine(L.player)) continue; // les accions dels altres les torna a aplicar el seu mòbil
    if (stopped || L.action.type === "undo") { dropped.push(L); stopped = true; continue; }
    try {
      let n = applyAction(cur, L.action, isWord, L.player);
      for (let k = 0; k < L.senyorsSwaps && senyorsAvailable(n, L.player); k++) n = swapSenyors(n, L.player);
      // El nom viatja amb l'acció de qui juga (D-08)
      const name = v.players[L.player]?.name;
      if (name && n.players[L.player]) n.players[L.player]!.name = name;
      versions.push(n);
      applied.push(L);
      cur = n;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      dropped.push(L);
      stopped = true;
    }
  }
  return { versions, applied, dropped };
}

/** Rèplica nova a partir d'un paquet rebut (unir-se a una partida o recuperar-la). */
export function replicaFromPacket(key: Uint8Array, p: Packet, seats: number[]): Replica {
  return adoptTheirs(newReplica(key, p.state, seats), p);
}

/** Quan la gent tria la versió de l'altre mòbil en un conflicte. */
export function adoptTheirs(r: Replica, p: Packet): Replica {
  const I = p.state;
  const ancestors = new Map<number, string>();
  p.ancestors.forEach((h, k) => { if (h) ancestors.set(I.seq - 1 - k, h); });
  if (I.prevHash) ancestors.set(I.seq - 1, I.prevHash.slice(0, 8));
  return withVersions(r, I.seq - 1, [I], ancestors);
}

// ---------------------------------------------------------------- desar

export function serializeReplica(r: Replica): string {
  return JSON.stringify({
    key: toB64u(r.key),
    seats: r.seats,
    states: r.states.map(s => toB64u(encodeState(s))),
    known: [...r.known],
  });
}

export function parseReplica(text: string): Replica {
  const j = JSON.parse(text) as { key: string; seats: number[]; states: string[]; known: [number, string][] };
  const states = j.states.map(s => decodeState(fromB64u(s)));
  if (!states.length) throw new Error("Rèplica buida");
  return { key: fromB64u(j.key), seats: j.seats, states, known: new Map(j.known) };
}
