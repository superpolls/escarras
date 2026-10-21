/**
 * Desa la partida d'aquest mòbil (una sola partida per mòbil, encàrrec secció 1).
 * localStorage pot fallar (navegació privada, espai ple): mai no ha de trencar el joc.
 */
import { decodeState } from "../core/codec";
import type { GameState } from "../core/types";
import { fromB64u, toB64u } from "../sync/bytes";
import { newDeviceId, newGameKey } from "../sync/crypto";
import { commitLocal, newReplica, serializeReplica } from "../sync/replica";
import type { Store } from "../sync/session";

const KEY = "escarras-partida-v2";
const OLD_KEY = "escarras-partida-v1";
const DEVICE_KEY = "escarras-dispositiu";

const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* res */ } };
const del = (k: string): void => { try { localStorage.removeItem(k); } catch { /* res */ } };

export const gameStore: Store & { clear(): void } = {
  load: () => get(KEY) ?? migrate(),
  save: t => put(KEY, t),
  clear: () => { del(KEY); del(OLD_KEY); },
};

/** Partides desades per la versió d'un sol mòbil (M3): tots els jugadors en aquest mòbil. */
function migrate(): string | null {
  const raw = get(OLD_KEY);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { state: string; prev: string | null };
    const b = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const state: GameState = decodeState(b(j.state));
    const prev = j.prev ? decodeState(b(j.prev)) : null;
    const seats = state.players.map((_, i) => i);
    const r = prev && prev.seq === state.seq - 1 ? commitLocal(newReplica(newGameKey(), prev, seats), state) : newReplica(newGameKey(), state, seats);
    const text = JSON.stringify({ replica: serializeReplica(r), wantSeat: null });
    put(KEY, text);
    del(OLD_KEY);
    return text;
  } catch {
    return null;
  }
}

/** Identificador aleatori d'aquest mòbil; es conserva entre partides. */
export function deviceId(): string {
  let d = get(DEVICE_KEY);
  if (!d || d.length !== 22) { d = newDeviceId(); put(DEVICE_KEY, d); }
  return d;
}

/** Demana al navegador que no esborri les dades d'aquesta web (sobretot a iPhone). */
export async function askPersistence(): Promise<void> {
  try { await navigator.storage?.persist?.(); } catch { /* res */ }
}

/**
 * Ordre de l'atril que cada jugador s'ha preparat (només en aquest mòbil).
 * Es desa per fitxes, no per posicions: en robar fitxes noves, les que ja tenies mantenen l'ordre.
 */
const RACK_KEY = "escarras-atrils-v1";

export function loadArrangement(gameId: string, player: number): number[] | null {
  try {
    const j = JSON.parse(get(RACK_KEY) ?? "null") as { gameId: string; racks: Record<string, number[]> } | null;
    return j?.gameId === gameId ? j.racks[player] ?? null : null;
  } catch {
    return null;
  }
}

export function saveArrangement(gameId: string, player: number, tiles: number[]): void {
  try {
    const j = JSON.parse(get(RACK_KEY) ?? "null") as { gameId: string; racks: Record<string, number[]> } | null;
    const racks = j?.gameId === gameId ? j.racks : {};
    racks[player] = tiles;
    put(RACK_KEY, JSON.stringify({ gameId, racks }));
  } catch { /* res */ }
}

/** Nom nou que un jugador ha triat: viatja amb la seva propera acció (D-08). */
const NAME_KEY = "escarras-noms-v1";

export function pendingNames(gameId: string): Record<number, string> {
  try {
    const j = JSON.parse(get(NAME_KEY) ?? "null") as { gameId: string; names: Record<number, string> } | null;
    return j?.gameId === gameId ? j.names : {};
  } catch {
    return {};
  }
}

export function setPendingName(gameId: string, player: number, name: string | null): void {
  const names = { ...pendingNames(gameId) };
  if (name === null) delete names[player]; else names[player] = name;
  put(NAME_KEY, JSON.stringify({ gameId, names }));
}

export const keyToText = toB64u;
export const keyFromText = fromB64u;
