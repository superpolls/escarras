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
