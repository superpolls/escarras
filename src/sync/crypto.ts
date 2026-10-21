/**
 * Xifratge de la sala en línia (encàrrec 5.7). De la clau de l'enllaç (16 bytes) en surten:
 *  - l'adreça de la sala: SHA-256("escarras-sala" + clau), 16 bytes en Base64 (22 caràcters);
 *  - la clau AES-GCM de 256 bits: SHA-256("escarras-clau" + clau).
 * El servidor només veu l'adreça, la versió i dades xifrades. AES-GCM detecta qualsevol alteració.
 */
import { sha256 } from "../core/sha256";
import { concat, fromB64u, toB64u } from "./bytes";

const utf8 = (t: string) => new TextEncoder().encode(t);
/** Còpia en un ArrayBuffer propi (WebCrypto no accepta vistes sobre memòria compartida). */
const own = (b: Uint8Array) => new Uint8Array(b);

export interface RoomKeys {
  room: string;
  aes: CryptoKey;
}

export function roomId(key: Uint8Array): string {
  return toB64u(sha256(concat(utf8("escarras-sala"), key)).subarray(0, 16));
}

export async function roomKeys(key: Uint8Array): Promise<RoomKeys> {
  const raw = sha256(concat(utf8("escarras-clau"), key));
  const aes = await crypto.subtle.importKey("raw", own(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { room: roomId(key), aes };
}

/** Xifra el paquet. La versió (seq) va com a dada autenticada: no es pot canviar sense que es noti. */
export async function seal(aes: CryptoKey, bytes: Uint8Array, seq: number): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8(`h:${seq}`) }, aes, own(bytes)));
  return toB64u(concat(iv, ct));
}

export async function unseal(aes: CryptoKey, text: string, seq: number): Promise<Uint8Array> {
  const all = fromB64u(text);
  const iv = own(all.subarray(0, 12));
  const ct = own(all.subarray(12));
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8(`h:${seq}`) }, aes, ct));
}

/** Identificador aleatori d'aquest mòbil (22 caràcters). No diu res de qui és. */
export const newDeviceId = () => toB64u(crypto.getRandomValues(new Uint8Array(16)));
export const newGameKey = () => crypto.getRandomValues(new Uint8Array(16));
