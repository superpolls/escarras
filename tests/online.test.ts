import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stateHash } from "../src/core/codec";
import { applyAction, createGame } from "../src/core/game";
import type { GameState } from "../src/core/types";
import { roomId } from "../src/sync/crypto";
import { normalize, applyEvent } from "../src/sync/relay";
import { newReplica, replicaFromPacket } from "../src/sync/replica";
import { readRoom, Session } from "../src/sync/session";
import { startFakeRtdb, type FakeRtdb } from "./fake-rtdb";
import { gameIdOf, seedOf } from "./helpers";
import { anyWord, makeRnd, randomAction } from "./sim";

const KEY = Uint8Array.from({ length: 16 }, (_, i) => 200 - i);
const dev = (n: number) => `device${String(n).padStart(16, "0")}`; // 22 caràcters
const memStore = () => { let v: string | null = null; return { load: () => v, save: (t: string) => { v = t; } }; };

async function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("Temps esgotat");
    await new Promise(r => setTimeout(r, 20));
  }
}

let fake: FakeRtdb;
const sessions: Session[] = [];
beforeEach(async () => { fake = await startFakeRtdb(); });
afterEach(async () => { for (const s of sessions.splice(0)) s.close(); await fake.close(); });

function open(replica: ReturnType<typeof newReplica>, device: string, wantSeat: number | null = null): Session {
  const s = new Session({
    replica, deviceId: device, isWord: anyWord, server: fake.url, store: memStore(),
    relay: { EventSource: null, pollMs: 30 }, describe: (_s, l) => l.action.type, wantSeat,
  });
  sessions.push(s);
  void s.connect();
  return s;
}

/** Crea la partida en un mòbil i hi uneix els altres amb l'enllaç (seient automàtic). */
async function table(n: number): Promise<{ g: GameState; phones: Session[] }> {
  const g = createGame({ gameId: gameIdOf(50), seed: seedOf(50), names: ["Anna", "Biel", "Carla", "Dani"].slice(0, n) });
  const phones = [open(newReplica(KEY, g, [0]), dev(0))];
  await waitFor(() => phones[0]!.net === "synced");
  for (let i = 1; i < n; i++) {
    const room = (await readRoom(fake.url, KEY))!;
    const s = open(replicaFromPacket(KEY, room.packet, []), dev(i));
    await waitFor(() => s.net === "synced");
    expect(await s.autoSeat()).toBe(i);
    phones.push(s);
  }
  return { g, phones };
}

const converged = (phones: Session[]) => phones.every(p => stateHash(p.head) === stateHash(phones[0]!.head));
const turnPhone = (phones: Session[]) => phones.find(p => p.holds(p.head.current))!;

describe("en línia (servidor fals amb les regles de Firebase)", () => {
  it("crear, unir-se amb l'enllaç i jugar: cada jugada arriba a tots i es verifica", async () => {
    const { phones } = await table(3);
    await waitFor(() => Object.keys(phones[0]!.seats).length === 3);
    expect(Object.values(phones[0]!.seats).map(e => e.d).sort()).toEqual([dev(0), dev(1), dev(2)]);
    const rnd = makeRnd(1);
    for (let k = 0; k < 9; k++) {
      const p = turnPhone(phones);
      p.commit(applyAction(p.head, randomAction(p.head, rnd), anyWord));
      await waitFor(() => converged(phones) && phones.every(x => x.net === "synced"));
    }
    expect(phones[0]!.head.seq).toBe(9);
    // El servidor no veu ni noms ni fitxes
    const raw = JSON.stringify(fake.data());
    expect(raw).not.toContain("Anna");
    expect(raw).toContain(roomId(KEY));
  });

  it("dos mòbils publiquen alhora: el segon fa rebase i es conserven les dues accions", async () => {
    const { phones } = await table(3);
    const mover = turnPhone(phones);
    const leaver = phones.find(p => p !== mover && p.head.order[1] !== p.seatsHere[0]) ?? phones.find(p => p !== mover)!;
    const seat = leaver.seatsHere[0]!;
    const rnd = makeRnd(2);
    mover.commit(applyAction(mover.head, randomAction(mover.head, rnd), anyWord));
    leaver.commit(applyAction(leaver.head, { type: "leave" }, anyWord, seat));
    await waitFor(() => converged(phones) && phones.every(x => x.net === "synced"));
    const h = phones[0]!.head;
    expect(h.seq).toBe(2);
    expect(h.players[seat]!.status).toBe("retired");
    expect(phones.some(p => p.notices.some(n => n.text.startsWith("S'ha tornat a aplicar")))).toBe(true);
  });

  it("sense servidor es juga amb QR; en tornar, tot es puja i convergeix", async () => {
    const { phones } = await table(2);
    fake.setDown(true);
    const rnd = makeRnd(3);
    for (let k = 0; k < 4; k++) {
      const p = turnPhone(phones);
      p.commit(applyAction(p.head, randomAction(p.head, rnd), anyWord));
      const other = phones.find(x => x !== p)!;
      other.scan(p.qrPacket()); // el QR
    }
    await waitFor(() => phones.every(x => x.net === "pending" || x.net === "offline"));
    fake.setDown(false);
    phones.forEach(p => p.kick());
    await waitFor(() => converged(phones) && phones.every(x => x.net === "synced"), 15000);
    expect(phones[0]!.head.seq).toBe(4);
  });

  it("desfer massa tard: el servidor ja té la jugada següent i el desfer es descarta amb un avís", async () => {
    const { phones } = await table(2);
    const a = turnPhone(phones);
    const b = phones.find(p => p !== a)!;
    const rnd = makeRnd(4);
    a.commit(applyAction(a.head, randomAction(a.head, rnd), anyWord));
    await waitFor(() => converged(phones));
    a.close(); // A deixa d'escoltar un moment
    b.commit(applyAction(b.head, randomAction(b.head, rnd), anyWord));
    await waitFor(() => b.net === "synced" && b.head.seq === 2);
    const a2 = open(a.replica, dev(0));
    expect(a2.undo()).toBe(true); // A encara no ho sap i desfà
    await waitFor(() => stateHash(a2.head) === stateHash(b.head) && a2.net === "synced");
    expect(a2.notices.some(n => n.text.includes("undo"))).toBe(true);
  });

  it("recuperar el seient des d'un altre mòbil: ho confirma un altre jugador", async () => {
    const { phones } = await table(2);
    const [anna, biel] = phones as [Session, Session];
    const room = (await readRoom(fake.url, KEY))!;
    const nou = open(replicaFromPacket(KEY, room.packet, []), dev(9));
    await waitFor(() => nou.net === "synced");
    expect(await nou.autoSeat()).toBeNull(); // no queda cap seient lliure
    expect(await nou.requestSeat(1)).toBe("requested");
    await waitFor(() => anna.claimsToConfirm.length === 1);
    expect(biel.claimsToConfirm).toEqual([]); // qui porta aquest jugador no ho confirma
    await anna.answerClaim(dev(9), 1, true);
    await waitFor(() => nou.holds(1) && !biel.holds(1));
    expect(biel.notices.at(-1)!.text).toContain("ja no porta");
  });
});

describe("esdeveniments de Firebase", () => {
  it("put i patch sobre la còpia local", () => {
    let root = applyEvent(null, "put", "/", { h: { s: 1, p: -1, d: "x" } });
    root = applyEvent(root, "put", "/s/0", { d: "a", p: "" });
    root = applyEvent(root, "patch", "/c", { dev1: 1 });
    root = applyEvent(root, "put", "/c/dev1", null);
    expect(normalize(root)).toEqual({ head: { s: 1, p: -1, d: "x" }, seats: { 0: { d: "a", p: "" } }, claims: {} });
    expect(normalize([{ d: "a", p: "" }] as never).seats).toEqual({}); // arrel sense «s»
    expect(normalize({ s: [{ d: "a", p: "" }, { d: "b", p: "a" }] }).seats).toEqual({ 0: { d: "a", p: "" }, 1: { d: "b", p: "a" } });
  });
});
