/**
 * Bústia en línia: Firebase Realtime Database per la seva API REST (sense la llibreria de Firebase).
 *
 * Estructura d'una sala (regles a firebase/database.rules.json):
 *   r/<sala>/h        { s: versió, p: versió de partida, d: paquet xifrat }   ← només s'accepta si p = s actual
 *   r/<sala>/s/<i>    { d: mòbil, p: mòbil anterior ("" si era lliure) }      ← seient i, amb el mateix candau
 *   r/<sala>/c/<mòbil> i                                                       ← petició per recuperar el seient i
 *
 * Escoltar: Server-Sent Events (EventSource) amb esdeveniments «put» i «patch»; si no funciona, consulta periòdica.
 */
export interface HeadEntry { s: number; p: number; d: string }
export interface SeatEntry { d: string; p: string }

export interface RoomSnapshot {
  head: HeadEntry | null;
  seats: Record<number, SeatEntry>;
  claims: Record<string, number>;
}

export class OfflineError extends Error {}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface RelayOptions {
  fetch?: typeof fetch;
  EventSource?: typeof EventSource | null;
  /** Interval de consulta quan no hi ha EventSource (ms). */
  pollMs?: number;
}

export function normalize(raw: Json): RoomSnapshot {
  const o = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, Json>;
  const h = o.h as Record<string, Json> | undefined;
  const head = h && typeof h.s === "number" && typeof h.p === "number" && typeof h.d === "string" ? { s: h.s, p: h.p, d: h.d } : null;
  const seats: Record<number, SeatEntry> = {};
  const rawSeats = o.s;
  if (rawSeats && typeof rawSeats === "object") {
    // Firebase pot tornar els seients numèrics com a llista
    for (const [k, v] of Object.entries(rawSeats)) {
      const e = v as Record<string, Json> | null;
      if (e && typeof e.d === "string") seats[Number(k)] = { d: e.d, p: typeof e.p === "string" ? e.p : "" };
    }
  }
  const claims: Record<string, number> = {};
  if (o.c && typeof o.c === "object" && !Array.isArray(o.c)) {
    for (const [k, v] of Object.entries(o.c)) if (typeof v === "number") claims[k] = v;
  }
  return { head, seats, claims };
}

/** Aplica un esdeveniment put/patch de Firebase a la còpia local de la sala. */
export function applyEvent(root: Json, kind: "put" | "patch", path: string, data: Json): Json {
  const parts = path.split("/").filter(Boolean);
  const setAt = (node: Json, i: number): Json => {
    if (i === parts.length) {
      if (kind === "put") return data;
      const base = node && typeof node === "object" && !Array.isArray(node) ? { ...node } : {};
      for (const [k, v] of Object.entries((data ?? {}) as Record<string, Json>)) {
        if (v === null) delete base[k]; else base[k] = v;
      }
      return base;
    }
    const base: Record<string, Json> = node && typeof node === "object" ? { ...(node as Record<string, Json>) } : {};
    const child = setAt(base[parts[i]!] ?? null, i + 1);
    if (child === null) delete base[parts[i]!]; else base[parts[i]!] = child;
    return Object.keys(base).length ? base : null;
  };
  return setAt(root, 0);
}

export class Relay {
  private readonly f: typeof fetch;
  private readonly ES: typeof EventSource | null;
  private readonly pollMs: number;

  constructor(private readonly base: string, readonly room: string, opts: RelayOptions = {}) {
    this.f = opts.fetch ?? fetch.bind(globalThis);
    this.ES = opts.EventSource === undefined ? (typeof EventSource === "undefined" ? null : EventSource) : opts.EventSource;
    this.pollMs = opts.pollMs ?? 4000;
  }

  private url(path: string): string {
    return `${this.base.replace(/\/+$/, "")}/r/${this.room}${path}.json`;
  }

  private async request(method: string, path: string, body?: Json): Promise<Response> {
    try {
      return await this.f(this.url(path), {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (e) {
      throw new OfflineError(String(e));
    }
  }

  async read(): Promise<RoomSnapshot> {
    const r = await this.request("GET", "");
    if (!r.ok) throw new OfflineError(`HTTP ${r.status}`);
    return normalize((await r.json()) as Json);
  }

  /** Escriptura amb candau: true si el servidor l'accepta, false si la regla la rebutja (algú ha escrit abans). */
  private async put(path: string, body: Json): Promise<boolean> {
    const r = await this.request("PUT", path, body);
    if (r.ok) return true;
    if (r.status === 401 || r.status === 403) return false;
    throw new OfflineError(`HTTP ${r.status}`);
  }

  putHead(entry: HeadEntry): Promise<boolean> {
    return this.put("/h", { s: entry.s, p: entry.p, d: entry.d });
  }

  claimSeat(seat: number, device: string, previous: string): Promise<boolean> {
    return this.put(`/s/${seat}`, { d: device, p: previous });
  }

  requestSeat(device: string, seat: number): Promise<boolean> {
    return this.put(`/c/${device}`, seat);
  }

  async dropRequest(device: string): Promise<void> {
    const r = await this.request("DELETE", `/c/${device}`);
    if (!r.ok && r.status !== 401 && r.status !== 403) throw new OfflineError(`HTTP ${r.status}`);
  }

  /**
   * Escolta la sala. Crida `onSnapshot` amb l'estat sencer cada cop que canvia,
   * i `onLink` quan es connecta o es desconnecta. Torna la funció per deixar d'escoltar.
   */
  watch(onSnapshot: (s: RoomSnapshot) => void, onLink: (up: boolean) => void): () => void {
    let stopped = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let root: Json = null;
    let opened = false;
    let failures = 0;

    const poll = async () => {
      if (stopped) return;
      try {
        const snap = await this.read();
        onLink(true);
        onSnapshot(snap);
      } catch {
        onLink(false);
      }
      if (!stopped) timer = setTimeout(poll, this.pollMs);
    };

    const ES = this.ES;
    if (!ES) {
      void poll();
    } else {
      es = new ES(this.url(""));
      const handle = (kind: "put" | "patch") => (ev: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(ev.data) as { path: string; data: Json };
          root = applyEvent(root, kind, msg.path, msg.data);
          onSnapshot(normalize(root));
        } catch { /* esdeveniment malmès: s'ignora */ }
      };
      es.addEventListener("put", handle("put") as EventListener);
      es.addEventListener("patch", handle("patch") as EventListener);
      es.addEventListener("open", () => { opened = true; failures = 0; onLink(true); });
      es.addEventListener("error", () => {
        onLink(false);
        failures += 1;
        // Si l'EventSource no arriba a obrir-se mai, es passa a consultar periòdicament
        if (!opened && failures >= 3 && es) { es.close(); es = null; void poll(); }
      });
      es.addEventListener("cancel", () => { es?.close(); es = null; void poll(); });
    }
    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }
}
