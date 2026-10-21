/**
 * Sessió: la partida d'aquest mòbil i la seva sincronització, pel QR i pel servidor.
 * No depèn de la pantalla: la interfície l'escolta (subscribe) i hi crida accions.
 *
 * En línia (encàrrec 5.7, D-23):
 *  - Cada versió nova es publica amb candau: «parteixo de la versió p»; si algú ha publicat abans,
 *    es rep la seva, s'integra (rebase si cal) i es torna a provar.
 *  - El servidor fa d'àrbitre dels empats de la mateixa versió.
 *  - Sense connexió, les versions queden pendents i es publiquen en tornar-hi; sempre es pot fer servir el QR.
 */
import { canUndo, undoState, type IsWord } from "../core/game";
import type { GameState, LastAction } from "../core/types";
import { roomKeys, seal, unseal, type RoomKeys } from "./crypto";
import { sameBytes } from "./bytes";
import { decodePacket, encodePacket, type Packet } from "./packet";
import { OfflineError, Relay, type RelayOptions, type RoomSnapshot } from "./relay";
import {
  adoptTheirs, commitLocal, headOf, packetOf, parseReplica, previousOf, receive, serializeReplica, SERVER_ANCESTORS, short,
  type Outcome, type Replica,
} from "./replica";

export type NetStatus = "none" | "connecting" | "synced" | "pending" | "offline";

export interface Store {
  load(): string | null;
  save(text: string): void;
}

export interface Notice { id: number; text: string }

export interface SessionOptions {
  replica: Replica;
  deviceId: string;
  isWord: IsWord;
  /** Adreça de la base de dades de Firebase, o null si no n'hi ha (només QR). */
  server: string | null;
  store: Store;
  relay?: RelayOptions;
  /** Text d'una acció per als avisos («Anna ha passat»). */
  describe: (state: GameState, last: LastAction) => string;
  /** Seient que aquest mòbil ha demanat recuperar i espera que li confirmin. */
  wantSeat?: number | null;
}

export class Session {
  replica: Replica;
  readonly deviceId: string;
  net: NetStatus;
  /** Qui té cada seient al servidor. */
  seats: RoomSnapshot["seats"] = {};
  /** Peticions per recuperar un seient: mòbil → seient. */
  claims: Record<string, number> = {};
  /** Versió rebuda per QR que entra en conflicte amb la d'aquest mòbil: la gent ha de triar. */
  conflict: Packet | null = null;
  notices: Notice[] = [];
  wantSeat: number | null;

  private readonly isWord: IsWord;
  private readonly server: string | null;
  private readonly store: Store;
  private readonly relayOptions: RelayOptions | undefined;
  private readonly describe: SessionOptions["describe"];
  private keys: RoomKeys | null = null;
  private relay: Relay | null = null;
  private snapshot: RoomSnapshot | null = null;
  private serverHash: string | null = null;
  private stopWatch: (() => void) | null = null;
  private busy = false;
  private again = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private noticeId = 0;
  private readonly listeners = new Set<() => void>();
  private myTurnListeners = new Set<() => void>();
  private closed = false;

  constructor(o: SessionOptions) {
    this.replica = o.replica;
    this.deviceId = o.deviceId;
    this.isWord = o.isWord;
    this.server = o.server;
    this.store = o.store;
    this.relayOptions = o.relay;
    this.describe = o.describe;
    this.wantSeat = o.wantSeat ?? null;
    this.net = o.server ? "connecting" : "none";
  }

  get head(): GameState { return headOf(this.replica); }
  get seatsHere(): number[] { return this.replica.seats; }
  holds(player: number): boolean { return this.replica.seats.includes(player); }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onMyTurn(fn: () => void): () => void { this.myTurnListeners.add(fn); return () => this.myTurnListeners.delete(fn); }
  private emit(): void { for (const f of this.listeners) f(); }

  private connecting: Promise<void> | null = null;

  /** Es connecta a la sala (si hi ha servidor). Es pot cridar diverses vegades. */
  connect(): Promise<void> {
    return (this.connecting ??= this.doConnect());
  }

  private async doConnect(): Promise<void> {
    if (!this.server || this.relay) return;
    this.keys = await roomKeys(this.replica.key);
    if (this.closed) return;
    this.relay = new Relay(this.server, this.keys.room, this.relayOptions);
    this.stopWatch = this.relay.watch(
      snap => { this.snapshot = snap; void this.sync(); },
      up => { if (!up && this.net !== "none") { this.setNet(this.pending ? "pending" : "offline"); this.scheduleRetry(); } },
    );
    void this.sync();
  }

  close(): void {
    this.closed = true;
    this.stopWatch?.();
    if (this.retry) clearTimeout(this.retry);
  }

  // ------------------------------------------------------------ accions locals

  /** Afegeix una versió feta en aquest mòbil i la publica. */
  commit(next: GameState): void {
    this.replica = commitLocal(this.replica, next);
    this.persist();
    this.emit();
    void this.sync();
  }

  /** Es pot desfer l'última acció si l'ha fet aquest mòbil i encara és l'última versió coneguda. */
  canUndo(): boolean {
    const h = this.head;
    return !!h.last && canUndo(h, h.last.player) && this.holds(h.last.player) && !!previousOf(this.replica);
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.commit(undoState(this.head, previousOf(this.replica)!));
    return true;
  }

  /** Aquest mòbil passa a portar també aquests jugadors (mòbil compartit o recuperació per QR). */
  takeSeats(players: number[]): void {
    this.replica = { ...this.replica, seats: [...new Set([...this.replica.seats, ...players])].sort((a, b) => a - b) };
    this.persist();
    this.emit();
    void this.sync();
  }

  // ------------------------------------------------------------ QR

  /** Paquet per mostrar en un QR. Porta la clau, perquè qui l'escanegi pugui passar a jugar en línia. */
  qrPacket(seat: number | null = null): Packet {
    return packetOf(this.replica, { ancestors: 8, key: true, seat });
  }

  /** Integra un paquet llegit d'un QR. */
  scan(p: Packet): Outcome {
    if (p.key && !sameBytes(p.key, this.replica.key)) return { kind: "foreign" };
    const res = receive(this.replica, p, this.isWord, false);
    this.integrate(res.replica, res.outcome);
    if (res.outcome.kind === "conflict") this.conflict = p;
    this.emit();
    return res.outcome;
  }

  /** Resol un conflicte: la versió de l'altre mòbil o la d'aquest. */
  resolveConflict(theirs: boolean): void {
    if (this.conflict && theirs) {
      this.replica = adoptTheirs(this.replica, this.conflict);
      this.persist();
    }
    this.conflict = null;
    this.emit();
    void this.sync();
  }

  dismissNotice(id: number): void {
    this.notices = this.notices.filter(n => n.id !== id);
    this.emit();
  }

  /** Avís per a la gent d'aquest mòbil. */
  say(text: string): void {
    this.notice(text);
    this.emit();
  }

  private notice(text: string): void {
    this.notices = [...this.notices.slice(-3), { id: ++this.noticeId, text }];
  }

  private integrate(replica: Replica, outcome: Outcome): void {
    if (outcome.kind !== "advanced" && outcome.kind !== "merged") return;
    const wasMine = this.holds(this.head.current) && !this.head.ended;
    this.replica = replica;
    if (outcome.kind === "merged") {
      for (const d of outcome.dropped) this.notice(`S'ha descartat: ${this.describe(this.head, d)}. Un altre mòbil ja havia continuat la partida.`);
      for (const a of outcome.applied) this.notice(`S'ha tornat a aplicar: ${this.describe(this.head, a)}.`);
    }
    this.persist();
    if (!wasMine && this.holds(this.head.current) && !this.head.ended) for (const f of this.myTurnListeners) f();
  }

  // ------------------------------------------------------------ en línia

  /** Hi ha versions d'aquest mòbil que el servidor encara no té. */
  get pending(): boolean {
    return !!this.server && this.serverHash !== short(this.head);
  }

  private setNet(n: NetStatus): void {
    if (this.net !== n) { this.net = n; this.emit(); }
  }

  private scheduleRetry(): void {
    if (this.retry || this.closed) return;
    this.retry = setTimeout(() => { this.retry = null; void this.sync(); }, 10000);
  }

  /** Torna a provar ara (p. ex., quan el navegador diu que torna a haver-hi xarxa). */
  kick(): void { void this.sync(); }

  private async sync(): Promise<void> {
    if (!this.relay || !this.keys || this.closed) return;
    // El navegador ja sap que no hi ha xarxa: no cal esperar que falli una petició
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setNet(this.pending ? "pending" : "offline");
      this.scheduleRetry();
      return;
    }
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try {
      let snap = this.snapshot ?? await this.relay.read();
      for (let round = 0; round < 6; round++) {
        this.again = false;
        const done = await this.reconcile(snap);
        if (done) break;
        snap = this.snapshot = await this.relay.read(); // algú ha publicat abans: es torna a llegir
      }
      await this.syncSeats(this.snapshot ?? snap);
      this.setNet(this.pending ? "pending" : "synced");
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      this.setNet(this.pending ? "pending" : "offline");
      this.scheduleRetry();
    } finally {
      this.busy = false;
    }
    if (this.again) void this.sync();
  }

  /** Posa d'acord aquest mòbil i el servidor. Torna false si el servidor ha rebutjat l'escriptura. */
  private async reconcile(snap: RoomSnapshot): Promise<boolean> {
    const H = snap.head;
    if (!H) return this.publish(-1); // sala nova: la crea aquest mòbil
    let incoming: Packet;
    try {
      incoming = decodePacket(await unseal(this.keys!.aes, H.d, H.s));
      if (incoming.state.seq !== H.s) throw new Error("versió");
    } catch {
      this.notice("Les dades del servidor no es poden llegir. Feu servir el QR.");
      this.serverHash = null;
      return true;
    }
    const res = receive(this.replica, incoming, this.isWord, true);
    switch (res.outcome.kind) {
      case "same":
        this.serverHash = short(incoming.state);
        return true;
      case "advanced":
        this.integrate(res.replica, res.outcome);
        this.serverHash = short(incoming.state);
        this.emit();
        return true;
      case "merged":
        this.integrate(res.replica, res.outcome);
        this.serverHash = short(incoming.state);
        this.emit();
        return this.head.seq > H.s ? this.publish(H.s) : true;
      case "older":
      case "kept":
        return this.publish(H.s);
      case "foreign":
      case "invalid":
      case "conflict":
        this.notice("La partida del servidor no quadra amb la d'aquest mòbil. Feu servir el QR.");
        return true;
    }
  }

  private async publish(base: number): Promise<boolean> {
    const h = this.head;
    const bytes = encodePacket(packetOf(this.replica, { ancestors: SERVER_ANCESTORS }));
    const entry = { s: h.seq, p: base, d: await seal(this.keys!.aes, bytes, h.seq) };
    const ok = await this.relay!.putHead(entry);
    if (ok) {
      this.serverHash = short(h);
      // La còpia local de la sala ja té la versió nova (no cal esperar l'avís del servidor)
      if (this.snapshot) this.snapshot = { ...this.snapshot, head: entry };
    }
    return ok;
  }

  /** Seients: ocupa els d'aquest mòbil, detecta si un altre mòbil n'ha pres algun i segueix les peticions. */
  private async syncSeats(snap: RoomSnapshot): Promise<void> {
    const relay = this.relay!;
    let changed = JSON.stringify([this.seats, this.claims]) !== JSON.stringify([snap.seats, snap.claims]);
    this.seats = snap.seats;
    this.claims = snap.claims;
    for (const i of [...this.replica.seats]) {
      const e = snap.seats[i];
      if (!e) {
        if (await relay.claimSeat(i, this.deviceId, "")) this.noteSeat(i, { d: this.deviceId, p: "" });
      } else if (e.d !== this.deviceId) {
        if (e.p === this.deviceId) {
          // Un altre mòbil l'ha recuperat amb la confirmació d'un jugador (D-22)
          this.replica = { ...this.replica, seats: this.replica.seats.filter(x => x !== i) };
          this.notice(`Aquest mòbil ja no porta ${this.head.players[i]?.name ?? "aquest jugador"}: ara el porta un altre mòbil`);
          changed = true;
        } else if (snap.claims[this.deviceId] !== i) {
          await relay.requestSeat(this.deviceId, i);
        }
      }
    }
    if (this.wantSeat !== null) {
      const w = this.wantSeat;
      if (snap.seats[w]?.d === this.deviceId) {
        this.replica = { ...this.replica, seats: [...new Set([...this.replica.seats, w])].sort((a, b) => a - b) };
        this.wantSeat = null;
        this.notice(`Confirmat: aquest mòbil porta ${this.head.players[w]?.name ?? "el teu jugador"}`);
        await relay.dropRequest(this.deviceId);
        changed = true;
      } else if (snap.claims[this.deviceId] === undefined) {
        this.wantSeat = null;
        this.notice("No t'han confirmat el jugador. Torna-ho a provar o demana el QR de la partida.");
        changed = true;
      }
    }
    if (changed) { this.persist(); this.emit(); }
  }

  /** En unir-se amb l'enllaç: ocupa el primer jugador actiu que encara no té mòbil. */
  async autoSeat(): Promise<number | null> {
    if (!this.relay) return null;
    const snap = await this.relay.read();
    this.snapshot = snap;
    const h = this.head;
    for (const i of h.players.keys()) {
      if (h.players[i]!.status !== "active" || snap.seats[i]) continue;
      if (await this.relay.claimSeat(i, this.deviceId, "")) { this.noteSeat(i, { d: this.deviceId, p: "" }); this.takeSeats([i]); return i; }
    }
    return null;
  }

  private noteSeat(i: number, e: { d: string; p: string }): void {
    this.seats = { ...this.seats, [i]: e };
    if (this.snapshot) this.snapshot = { ...this.snapshot, seats: { ...this.snapshot.seats, [i]: e } };
  }

  /** Demana recuperar un seient que ja té un altre mòbil: ho ha de confirmar un altre jugador (D-22). */
  async requestSeat(seat: number): Promise<"taken" | "requested" | "offline"> {
    if (!this.relay) return "offline";
    try {
      const snap = this.snapshot ?? await this.relay.read();
      if (!snap.seats[seat]) {
        if (await this.relay.claimSeat(seat, this.deviceId, "")) { this.noteSeat(seat, { d: this.deviceId, p: "" }); this.takeSeats([seat]); return "taken"; }
      }
      this.wantSeat = seat;
      await this.relay.requestSeat(this.deviceId, seat);
      this.persist();
      this.emit();
      return "requested";
    } catch {
      return "offline";
    }
  }

  /** Peticions d'altres mòbils que aquest pot confirmar (porta algun altre jugador actiu). */
  get claimsToConfirm(): { device: string; seat: number }[] {
    const h = this.head;
    return Object.entries(this.claims)
      .filter(([dev, seat]) => dev !== this.deviceId && this.seats[seat]?.d !== dev
        && this.replica.seats.some(s => s !== seat && h.players[s]?.status === "active"))
      .map(([device, seat]) => ({ device, seat }));
  }

  async answerClaim(device: string, seat: number, accept: boolean): Promise<void> {
    if (!this.relay) return;
    try {
      if (accept && await this.relay.claimSeat(seat, device, this.seats[seat]?.d ?? "")) this.noteSeat(seat, { d: device, p: this.seats[seat]?.d ?? "" });
      await this.relay.dropRequest(device);
      this.claims = Object.fromEntries(Object.entries(this.claims).filter(([d]) => d !== device));
      this.emit();
    } catch { /* sense connexió: es tornarà a preguntar */ }
  }

  // ------------------------------------------------------------ desar

  persist(): void {
    try {
      this.store.save(JSON.stringify({ replica: serializeReplica(this.replica), wantSeat: this.wantSeat }));
    } catch { /* l'emmagatzematge pot fallar (mode privat): el joc continua */ }
  }
}

export function loadSaved(text: string): { replica: Replica; wantSeat: number | null } {
  const j = JSON.parse(text) as { replica: string; wantSeat?: number | null };
  return { replica: parseReplica(j.replica), wantSeat: j.wantSeat ?? null };
}

/** Llegeix una sala per unir-s'hi amb l'enllaç: l'última versió i els seients. */
export async function readRoom(server: string, key: Uint8Array, opts?: RelayOptions): Promise<{ packet: Packet; seats: RoomSnapshot["seats"]; relay: Relay } | null> {
  const keys = await roomKeys(key);
  const relay = new Relay(server, keys.room, opts);
  const snap = await relay.read();
  if (!snap.head) return null;
  const packet = decodePacket(await unseal(keys.aes, snap.head.d, snap.head.s));
  return { packet, seats: snap.seats, relay };
}

