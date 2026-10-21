/**
 * Paquet: el bloc únic que viatja pel QR i pel servidor (encàrrec 5.7, «el mismo bloque»).
 *
 * Format 1 (bytes):
 *   versió(1) · senyals(1: bit7 porta clau, bit6 porta seient, bits0-2 seient)
 *   [clau de la partida (16)] · nombre d'avantpassats(1) · avantpassats (4 c/u)
 *   · estat codificat (codec.ts, amb el seu propi número de format)
 *
 * Avantpassats: empremtes curtes (4 bytes) de les versions anteriors, de la més recent a la més antiga.
 * Serveixen perquè un mòbil a qui falten versions comprovi que la nova ve de la seva (o detecti una bifurcació).
 * Al QR, el text és «ESC1:» + Base45(paquet + FNV-1a); al servidor, el paquet va xifrat (AES-GCM).
 */
import { decodeState, encodeState, FORMAT } from "../core/codec";
import { fromHex, toHex } from "../core/sha256";
import type { GameState } from "../core/types";
import { concat, fnv1a, fromB45, fromB64u, toB45, toB64u } from "./bytes";

export const PACKET_VERSION = 1;
export const QR_PREFIX = "ESC1:";
export const KEY_BYTES = 16;

export interface Packet {
  state: GameState;
  /** Empremtes curtes (8 caràcters hexadecimals) de les versions seq-1, seq-2…; "" si no se sap. */
  ancestors: string[];
  /** Clau de la partida: dona accés a la sala en línia. Va als QR; al servidor no cal. */
  key: Uint8Array | null;
  /** Seient assignat (invitació per QR); null si qui el rep l'ha de triar o ja el té. */
  seat: number | null;
}

export type PacketProblem = "not-ours" | "damaged" | "newer";

export class PacketError extends Error {
  constructor(readonly problem: PacketProblem) {
    super(problem);
  }
}

export function encodePacket(p: Packet): Uint8Array {
  if (p.key && p.key.length !== KEY_BYTES) throw new Error("Clau de mida incorrecta");
  if (p.seat !== null && (p.seat < 0 || p.seat > 7)) throw new Error("Seient fora de rang");
  if (p.ancestors.length > 255) throw new Error("Massa avantpassats");
  const flags = (p.key ? 0x80 : 0) | (p.seat !== null ? 0x40 | p.seat : 0);
  const anc = new Uint8Array(p.ancestors.length * 4);
  p.ancestors.forEach((h, i) => anc.set(h ? fromHex(h) : new Uint8Array(4), i * 4));
  return concat(Uint8Array.of(PACKET_VERSION, flags), p.key ?? new Uint8Array(0), Uint8Array.of(p.ancestors.length), anc, encodeState(p.state));
}

export function decodePacket(b: Uint8Array): Packet {
  if (b.length < 3) throw new PacketError("damaged");
  if (b[0]! > PACKET_VERSION) throw new PacketError("newer");
  if (b[0] !== PACKET_VERSION) throw new PacketError("not-ours");
  const flags = b[1]!;
  let at = 2;
  let key: Uint8Array | null = null;
  if (flags & 0x80) { key = b.slice(at, at + KEY_BYTES); at += KEY_BYTES; }
  const seat = flags & 0x40 ? flags & 7 : null;
  const n = b[at++];
  if (n === undefined || b.length < at + n * 4 + 1) throw new PacketError("damaged");
  const ancestors: string[] = [];
  for (let i = 0; i < n; i++) {
    const h = b.subarray(at + i * 4, at + i * 4 + 4);
    ancestors.push(h.every(x => x === 0) ? "" : toHex(h));
  }
  at += n * 4;
  if (b[at]! > FORMAT) throw new PacketError("newer");
  let state: GameState;
  try {
    state = decodeState(b.subarray(at));
  } catch {
    throw new PacketError("damaged");
  }
  return { state, ancestors, key, seat };
}

/** Text per al QR: prefix + Base45 del paquet amb la suma de control al final. */
export function packetToText(p: Packet): string {
  const bytes = encodePacket(p);
  const h = fnv1a(bytes);
  return QR_PREFIX + toB45(concat(bytes, Uint8Array.of(h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255)));
}

export function textToPacket(text: string): Packet {
  const t = text.trim();
  if (!t.startsWith(QR_PREFIX)) {
    if (/^ESC\d+:/.test(t)) throw new PacketError("newer");
    throw new PacketError("not-ours");
  }
  let raw: Uint8Array;
  try {
    raw = fromB45(t.slice(QR_PREFIX.length));
  } catch {
    throw new PacketError("damaged");
  }
  if (raw.length < 8) throw new PacketError("damaged");
  const body = raw.subarray(0, raw.length - 4);
  const sum = raw.subarray(raw.length - 4);
  const got = ((sum[0]! << 24) | (sum[1]! << 16) | (sum[2]! << 8) | sum[3]!) >>> 0;
  if (fnv1a(body) !== got) throw new PacketError("damaged");
  return decodePacket(body);
}

/** Enllaç d'invitació: la clau va darrere del «#», que el navegador no envia mai a cap servidor. */
export function inviteLink(base: string, key: Uint8Array): string {
  return `${base}#j=${toB64u(key)}`;
}

/** Llegeix la clau d'un enllaç d'invitació (sencer o només la part del «#»). */
export function parseInvite(text: string): Uint8Array | null {
  const m = /[#&]j=([A-Za-z0-9_-]{22})(?![A-Za-z0-9_-])/.exec(text.trim());
  if (!m) return null;
  try {
    const key = fromB64u(m[1]!);
    return key.length === KEY_BYTES ? key : null;
  } catch {
    return null;
  }
}
