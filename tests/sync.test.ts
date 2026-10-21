import { describe, expect, it } from "vitest";
import { stateHash } from "../src/core/codec";
import { activePlayers, applyAction, canUndo, createGame, tileInventoryOk, undoState, type IsWord } from "../src/core/game";
import type { Action, GameState } from "../src/core/types";
import { fromB64u, toB64u, toB45, fromB45 } from "../src/sync/bytes";
import {
  decodePacket, encodePacket, inviteLink, PacketError, packetToText, parseInvite, textToPacket, type Packet,
} from "../src/sync/packet";
import {
  adoptTheirs, commitLocal, headOf, newReplica, packetOf, parseReplica, previousOf, QR_ANCESTORS, receive,
  serializeReplica, type Outcome, type Replica,
} from "../src/sync/replica";
import { dict, gameIdOf, seedOf, setup, word } from "./helpers";
import { anyWord, makeRnd, randomAction } from "./sim";

const KEY = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1);

/** Un mòbil de prova: la seva rèplica i el que fa. */
class Phone {
  constructor(public r: Replica, readonly isWord: IsWord = anyWord) {}
  get head() { return headOf(this.r); }
  act(action: Action, actor = this.head.current): GameState {
    const next = applyAction(this.head, action, this.isWord, actor);
    this.r = commitLocal(this.r, next);
    return next;
  }
  undo(): void {
    this.r = commitLocal(this.r, undoState(this.head, previousOf(this.r)!));
  }
  /** El QR que mostra, passat per text com a la realitat. */
  qr(): Packet {
    return textToPacket(packetToText(packetOf(this.r, { ancestors: QR_ANCESTORS, key: true })));
  }
  scan(p: Packet, arbiter = false): Outcome {
    const res = receive(this.r, p, this.isWord, arbiter);
    this.r = res.replica;
    return res.outcome;
  }
}

function table(names: string[], g?: GameState): Phone[] {
  const state = g ?? createGame({ gameId: gameIdOf(3), seed: seedOf(3), names });
  return names.map((_, i) => new Phone(newReplica(KEY, state, [i])));
}

describe("paquet: el bloc que viatja pel QR i pel servidor", () => {
  it("text del QR d'anada i tornada, amb clau i seient", () => {
    const g = createGame({ gameId: gameIdOf(1), seed: seedOf(1), names: ["Anna", "Biel", "Carla"] });
    const p: Packet = { state: g, ancestors: ["", "0a0b0c0d"], key: KEY, seat: 2 };
    const t = packetToText(p);
    expect(t.startsWith("ESC1:")).toBe(true);
    expect(/^[0-9A-Z $%*+\-./:]+$/.test(t)).toBe(true); // mode alfanumèric del QR
    const back = textToPacket(t);
    expect(back.state).toEqual(g);
    expect(back.ancestors).toEqual(["", "0a0b0c0d"]);
    expect([...back.key!]).toEqual([...KEY]);
    expect(back.seat).toBe(2);
    expect(decodePacket(encodePacket({ ...p, key: null, seat: null }))).toMatchObject({ key: null, seat: null });
  });

  it("detecta codis d'altres apps, malmesos o d'una versió més nova", () => {
    const t = packetToText({ state: setup("C A S A E I O"), ancestors: [], key: null, seat: null });
    const problem = (x: string) => { try { textToPacket(x); return "ok"; } catch (e) { return (e as PacketError).problem; } };
    expect(problem("https://example.com")).toBe("not-ours");
    expect(problem("ESC2:ABC")).toBe("newer");
    const k = 40;
    const flipped = t.slice(0, k) + (t[k] === "A" ? "B" : "A") + t.slice(k + 1);
    expect(problem(flipped)).toBe("damaged");
    expect(problem(t.slice(0, -6))).toBe("damaged");
  });

  it("enllaç d'invitació amb la clau darrere del #", () => {
    const link = inviteLink("https://superpolls.github.io/escarras/app/", KEY);
    expect(link).toMatch(/\/app\/#j=[A-Za-z0-9_-]{22}$/);
    expect([...parseInvite(link)!]).toEqual([...KEY]);
    expect([...parseInvite(`Juguem? ${link} `)!]).toEqual([...KEY]);
    expect(parseInvite("https://superpolls.github.io/escarras/app/")).toBeNull();
  });

  it("Base64 i Base45 d'anada i tornada", () => {
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
      expect([...fromB64u(toB64u(b))]).toEqual([...b]);
      expect([...fromB45(toB45(b))]).toEqual([...b]);
    }
  });
});

describe("QR entre mòbils: cadena i verificació", () => {
  it("el següent repeteix la jugada; qui s'ha saltat versions les comprova amb les empremtes", () => {
    const rnd = makeRnd(11);
    const phones = table(["Anna", "Biel", "Carla"]);
    const first = phones[phones[0]!.head.current]!;
    first.act(randomAction(first.head, rnd));
    const second = phones[first.head.current]!;
    expect(second.scan(first.qr())).toEqual({ kind: "advanced", verified: "replay" });
    second.act(randomAction(second.head, rnd));
    const third = phones[second.head.current]!;
    expect(third.scan(second.qr())).toEqual({ kind: "advanced", verified: "chain" }); // li falta una versió
    expect(stateHash(third.head)).toBe(stateHash(second.head));
    expect(second.scan(first.qr())).toEqual({ kind: "older" }); // «Ja tens aquesta jugada»
    expect(second.scan(second.qr())).toEqual({ kind: "same" });
  });

  it("rebutja una partida diferent i una jugada manipulada", () => {
    const [a, b] = table(["Anna", "Biel"]);
    const other = new Phone(newReplica(KEY, createGame({ gameId: gameIdOf(9), seed: seedOf(9), names: ["X", "Y"] }), [0]));
    expect(b!.scan(other.qr())).toEqual({ kind: "foreign" });
    const mover = a!.head.current === 0 ? a! : b!;
    const watcher = mover === a ? b! : a!;
    mover.act({ type: "pass" });
    const p = mover.qr();
    p.state.players[0]!.score += 50;
    expect(watcher.scan(p).kind).toBe("invalid");
  });

  it("desfer abans que el següent escanegi: el següent rep directament l'estat desfet", () => {
    const rnd = makeRnd(5);
    const phones = table(["Anna", "Biel"]);
    const a = phones[phones[0]!.head.current]!;
    const b = phones.find(p => p !== a)!;
    const start = a.head;
    a.act(randomAction(a.head, rnd));
    a.undo();
    expect(b.scan(a.qr())).toEqual({ kind: "advanced", verified: "chain" });
    expect(b.head.board).toEqual(start.board);
    expect(b.head.current).toBe(start.current);
  });
});

describe("bifurcacions", () => {
  it("desfer massa tard: guanya la jugada del següent i el desfer es descarta", () => {
    const rnd = makeRnd(7);
    const phones = table(["Anna", "Biel"]);
    const a = phones[phones[0]!.head.current]!;
    const b = phones.find(p => p !== a)!;
    a.act(randomAction(a.head, rnd));
    b.scan(a.qr());
    b.act(randomAction(b.head, rnd)); // B ja ha jugat
    a.undo(); // A no ho sap i desfà
    const fromA = a.qr();
    const out = a.scan(b.qr());
    expect(out.kind).toBe("merged");
    expect(out.kind === "merged" && out.dropped.map(d => d.action.type)).toEqual(["undo"]);
    expect(stateHash(a.head)).toBe(stateHash(b.head));
    expect(b.scan(fromA)).toEqual({ kind: "kept" }); // B es queda la seva
  });

  it("abandonar mentre un altre juga: es conserven les dues accions", () => {
    const rnd = makeRnd(3);
    const phones = table(["Anna", "Biel", "Carla"]);
    const mover = phones[phones[0]!.head.current]!;
    const leaver = phones.find(p => p !== mover && p.head.current !== p.r.seats[0])!;
    const leaverSeat = leaver.r.seats[0]!;
    mover.act(randomAction(mover.head, rnd)); // jugada (prioritat alta)
    leaver.act({ type: "leave" }, leaverSeat); // al mateix temps, sense connexió
    const out = leaver.scan(mover.qr());
    expect(out.kind).toBe("merged");
    expect(out.kind === "merged" && out.applied.map(x => x.action.type)).toEqual(["leave"]);
    expect(leaver.head.players[leaverSeat]!.status).toBe("retired");
    expect(leaver.head.seq).toBe(2);
    // Qui va jugar rep l'abandonament per sobre de la seva jugada i el verifica repetint-lo
    expect(mover.scan(leaver.qr())).toEqual({ kind: "advanced", verified: "replay" });
    expect(tileInventoryOk(mover.head)).toBe(true);
  });

  it("dues accions igual de fortes: amb QR decideix la gent; en línia, el servidor", () => {
    const g = createGame({ gameId: gameIdOf(4), seed: seedOf(4), names: ["Anna", "Biel"] });
    const a = new Phone(newReplica(KEY, g, [0, 1]));
    const b = new Phone(newReplica(KEY, g, [0, 1])); // el mateix seient en dos mòbils (cas de recuperació)
    a.act({ type: "pass" });
    b.act({ type: "exchange", tiles: b.head.players[b.head.current]!.rack.slice(0, 2) });
    const out = a.scan(b.qr());
    expect(out.kind).toBe("conflict");
    a.r = adoptTheirs(a.r, b.qr());
    expect(stateHash(a.head)).toBe(stateHash(b.head));
    const c = new Phone(newReplica(KEY, g, [0]));
    c.act({ type: "pass" });
    expect(c.scan(b.qr(), true).kind).toBe("merged");
    expect(stateHash(c.head)).toBe(stateHash(b.head));
  });

  it("una proposta retirada i rebutjada alhora: els dos mòbils trien el mateix", () => {
    const known = dict("CASA");
    const g = setup("X I QU E T S A", ["Anna", "Biel"]);
    const anna = new Phone(newReplica(KEY, g, [0]), known);
    const biel = new Phone(newReplica(KEY, g, [1]), known);
    anna.act({ type: "propose", placements: word("H8", "XIQUETS", "H") });
    biel.scan(anna.qr());
    anna.act({ type: "reject" }, 0); // la retira
    biel.act({ type: "reject" }, 1); // la rebutja
    const fromAnna = anna.qr();
    anna.scan(biel.qr());
    biel.scan(fromAnna);
    expect(stateHash(anna.head)).toBe(stateHash(biel.head));
  });

  it("guanya la branca més llarga i qui perd torna a aplicar les seves accions si encara valen", () => {
    const rnd = makeRnd(21);
    const phones = table(["Anna", "Biel"]);
    const a = phones[phones[0]!.head.current]!;
    const b = phones.find(p => p !== a)!;
    a.act(randomAction(a.head, rnd));
    b.scan(a.qr());
    b.act({ type: "pass" }); // B passa
    a.undo(); // A desfà sense saber-ho…
    a.act({ type: "pass" }); // …i torna a jugar: la seva branca és més llarga
    const out = b.scan(a.qr());
    expect(out.kind).toBe("merged");
    // La passada de B es torna a aplicar: torna a ser el seu torn després de la nova jugada d'A
    expect(out.kind === "merged" && out.applied.map(x => x.action.type)).toEqual(["pass"]);
    expect(b.head.seq).toBe(4);
    expect(a.scan(b.qr())).toEqual({ kind: "advanced", verified: "replay" });
  });
});

describe("desar la rèplica", () => {
  it("d'anada i tornada", () => {
    const rnd = makeRnd(2);
    const [a] = table(["Anna", "Biel"]);
    for (let k = 0; k < 5; k++) a!.act(randomAction(a!.head, rnd));
    const back = parseReplica(serializeReplica(a!.r));
    expect(back.states.map(stateHash)).toEqual(a!.r.states.map(stateHash));
    expect([...back.known]).toEqual([...a!.r.known]);
    expect(back.seats).toEqual(a!.r.seats);
  });
});

describe("simulació: 3 mòbils sense connexió, QR a l'atzar, bifurcacions i desfers", () => {
  it("sempre convergeixen al mateix estat, vàlid", () => {
    const tally: Record<string, number> = {};
    let maxText = 0;
    for (let game = 0; game < 150; game++) {
      const rnd = makeRnd(1000 + game);
      const names = ["Anna", "Biel", "Carla"].slice(0, 2 + (game % 2));
      const phones = table(names, createGame({ gameId: gameIdOf(100 + game), seed: seedOf(100 + game), names }));
      const exchange = (x: Phone, y: Phone) => {
        const out = x.scan(y.qr());
        tally[out.kind] = (tally[out.kind] ?? 0) + 1;
        if (out.kind === "conflict" && stateHash(out.theirs) < stateHash(x.head)) x.r = adoptTheirs(x.r, y.qr());
        if (out.kind === "invalid" || out.kind === "foreign") throw new Error(`Partida ${game}: ${JSON.stringify(out)}`);
      };
      const gossip = () => {
        for (let round = 0; round < 10; round++) {
          for (const x of phones) for (const y of phones) if (x !== y) exchange(x, y);
          if (phones.every(p => stateHash(p.head) === stateHash(phones[0]!.head))) return;
        }
        throw new Error(`Partida ${game}: no convergeix`);
      };
      for (let step = 0; step < 400 && !phones[0]!.head.ended; step++) {
        const p = phones[rnd(phones.length)]!;
        const h = p.head;
        if (h.ended) continue;
        const seat = p.r.seats[0]!;
        const pick = rnd(100);
        try {
          if (pick < 4 && canUndo(h, seat) && previousOf(p.r)) p.undo();
          else if (pick < 6 && activePlayers(h).length > 2 && h.players[seat]!.status === "active") p.act({ type: "leave" }, seat);
          else if (h.current === seat) p.act(randomAction(h, rnd));
        } catch { /* acció no vàlida en aquest estat: res */ }
        // Lliurament d'un QR a l'atzar: no sempre al següent, com a la vida real
        if (rnd(100) < 70) {
          const from = phones[rnd(phones.length)]!;
          const to = phones[rnd(phones.length)]!;
          if (from !== to) exchange(to, from);
        }
        if (step % 12 === 11) gossip();
        maxText = Math.max(maxText, packetToText(packetOf(p.r, { ancestors: QR_ANCESTORS, key: true })).length);
      }
      gossip();
      const h = phones[0]!.head;
      expect(tileInventoryOk(h)).toBe(true);
      for (const ph of phones) expect(stateHash(ph.head)).toBe(stateHash(h));
    }
    console.log("Resultats en rebre QR:", tally, `· QR més llarg: ${maxText} caràcters`);
    expect(tally.merged).toBeGreaterThan(0);
    expect(tally.kept).toBeGreaterThan(0);
    expect(tally.advanced).toBeGreaterThan(0);
    expect(maxText).toBeLessThan(560);
  }, 300000);
});

describe("QR real: generar-lo i llegir-lo", () => {
  it("el cas gros (4 jugadors amb noms llargs, partida avançada) es dibuixa i es torna a llegir", async () => {
    const qrcode = (await import("qrcode-generator")).default;
    const jsQR = (await import("jsqr")).default;
    const names = ["Àngela Martí", "Bernat Puigd", "Ció Ferrer i", "Dolors Vilà "];
    let g = createGame({ gameId: gameIdOf(77), seed: seedOf(77), names: names.map(n => n.trim()) });
    const rnd = makeRnd(77);
    let r = newReplica(KEY, g, [0, 1, 2, 3]);
    for (let k = 0; k < 40 && !g.ended; k++) { g = applyAction(g, randomAction(g, rnd), anyWord); r = commitLocal(r, g); }
    const text = packetToText(packetOf(r, { ancestors: QR_ANCESTORS, key: true, seat: 3 }));
    const qr = qrcode(0, "M");
    qr.addData(text, "Alphanumeric");
    qr.make();
    const n = qr.getModuleCount();
    const scale = 4, quiet = 4, size = (n + quiet * 2) * scale;
    const px = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!qr.isDark(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
        px[o] = px[o + 1] = px[o + 2] = 0;
      }
    }
    const read = jsQR(px, size, size);
    expect(read?.data).toBe(text);
    const back = textToPacket(read!.data);
    expect(stateHash(back.state)).toBe(stateHash(g));
    console.log(`QR gros: ${text.length} caràcters, versió ${(n - 17) / 4} (${n}×${n} mòduls)`);
  });
});
