/**
 * Desa la partida en curs al mòbil (una sola partida per mòbil, encàrrec secció 1).
 * Es desa l'estat actual i l'anterior (per poder desfer), codificats com a l'intercanvi.
 * localStorage pot fallar (navegació privada, espai ple): mai no ha de trencar el joc.
 */
import { decodeState, encodeState } from "../core/codec";
import type { GameState } from "../core/types";

const KEY = "escarras-partida-v1";

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export interface Saved {
  state: GameState;
  prev: GameState | null;
}

export function saveGame(saved: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state: toB64(encodeState(saved.state)), prev: saved.prev ? toB64(encodeState(saved.prev)) : null }));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { state: string; prev: string | null };
    return { state: decodeState(fromB64(j.state)), prev: j.prev ? decodeState(fromB64(j.prev)) : null };
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try { localStorage.removeItem(KEY); } catch { /* res */ }
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
    const j = JSON.parse(localStorage.getItem(RACK_KEY) ?? "null") as { gameId: string; racks: Record<string, number[]> } | null;
    return j?.gameId === gameId ? j.racks[player] ?? null : null;
  } catch {
    return null;
  }
}

export function saveArrangement(gameId: string, player: number, tiles: number[]): void {
  try {
    const j = JSON.parse(localStorage.getItem(RACK_KEY) ?? "null") as { gameId: string; racks: Record<string, number[]> } | null;
    const racks = j?.gameId === gameId ? j.racks : {};
    racks[player] = tiles;
    localStorage.setItem(RACK_KEY, JSON.stringify({ gameId, racks }));
  } catch { /* res */ }
}
