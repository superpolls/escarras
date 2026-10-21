import { describe, expect, it } from "vitest";
import { cellIndex } from "../src/core/board";
import { stateHash } from "../src/core/codec";
import {
  applyAction, checkPlay, createGame, currentPlayer, EngineError, isSenyorsRack, rackValue,
  runStartDraw, senyorsAtTurnStart, senyorsAvailable, standings, swapSenyors, tileInventoryOk,
} from "../src/core/game";
import { VOWELS } from "../src/core/tiles";
import { dict, gameIdOf, put, seedOf, setup, T, word } from "./helpers";

const errorOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { if (e instanceof EngineError) return e.error; throw e; }
  return null;
};

describe("creació de la partida", () => {
  it("la mateixa llavor dona la mateixa partida; una altra, una partida diferent", () => {
    const a = createGame({ gameId: gameIdOf(1), seed: seedOf(5), names: ["A", "B", "C"] });
    const b = createGame({ gameId: gameIdOf(1), seed: seedOf(5), names: ["A", "B", "C"] });
    const c = createGame({ gameId: gameIdOf(1), seed: seedOf(6), names: ["A", "B", "C"] });
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).not.toBe(stateHash(c));
  });

  it("100 fitxes, 7 a cada atril i la resta a la bossa (5)", () => {
    for (let n = 2; n <= 4; n++) {
      const g = createGame({ gameId: gameIdOf(n), seed: seedOf(n), names: Array.from({ length: n }, (_, i) => `J${i + 1}`) });
      expect(tileInventoryOk(g)).toBe(true);
      for (const p of g.players) expect(p.rack).toHaveLength(7);
      expect(g.bag).toHaveLength(100 - 7 * n);
    }
  });

  it("l'ordre de joc comença pel guanyador del sorteig i segueix l'ordre dels noms", () => {
    const g = createGame({ gameId: gameIdOf(4), seed: seedOf(4), names: ["A", "B", "C", "D"] });
    expect(g.order[0]).toBe(g.first);
    expect(g.current).toBe(g.first);
    expect(g.order).toEqual([0, 1, 2, 3].map(k => (g.first + k) % 4));
  });
});

describe("sorteig d'inici (3)", () => {
  const run = (n: number, seq: number[]) => { let i = 0; return runStartDraw(n, () => seq[i++]!); };

  it("comença qui treu la fitxa més propera a l'A", () => {
    expect(run(3, [6, 1, 9]).first).toBe(1); // E, A, H
  });
  it("l'escarràs va davant de l'A", () => {
    expect(run(2, [1, 0]).first).toBe(1);
  });
  it("C davant de Ç, L davant de L·L, N davant de NY", () => {
    expect(run(2, [4, 3]).first).toBe(1);
    expect(run(2, [13, 12]).first).toBe(1);
    expect(run(2, [16, 15]).first).toBe(1);
  });
  it("en cas d'empat, només repeteixen els empatats", () => {
    const r = run(3, [5, 5, 9, 6, 3]); // D, D, H; després E, C
    expect(r.first).toBe(1);
    expect(r.rounds).toEqual([[5, 5, 9], [6, 3, -1]]);
  });
});

describe("jugades (9-15)", () => {
  const isWord = dict("CASA", "CASAS", "AS", "SI", "XARXA", "CANTAVA", "SAC");

  it("la primera jugada ha d'ocupar H8 (9)", () => {
    const g = setup("C A S A E I O");
    expect(errorOf(() => applyAction(g, { type: "play", placements: word("A1", "CASA", "H") }, isWord))).toEqual({ code: "first-center" });
  });
  it("la primera jugada ha de tenir almenys 2 fitxes (9)", () => {
    const g = setup("C A S A E I O");
    expect(errorOf(() => applyAction(g, { type: "play", placements: word("H8", "C", "H") }, isWord))).toEqual({ code: "first-two" });
  });
  it("fitxes en una sola fila o columna (10)", () => {
    const g = setup("C A S A E I O");
    const p = [{ index: cellIndex("H8"), tile: T("C")[0]!, letter: T("C")[0]! }, { index: cellIndex("I9"), tile: T("A")[0]!, letter: T("A")[0]! }];
    expect(errorOf(() => applyAction(g, { type: "play", placements: p }, isWord))).toEqual({ code: "not-aligned" });
  });
  it("sense forats (11)", () => {
    const g = setup("C A S A E I O");
    const p = word("H8", "CASA", "H");
    p[3]!.index += 1; // deixa J8.. amb un forat
    expect(errorOf(() => applyAction(g, { type: "play", placements: p }, isWord))).toEqual({ code: "gap" });
  });
  it("les jugades següents han de tocar fitxes del tauler (11)", () => {
    const g = setup("C A S A E I O");
    put(g, "H8", "CASA", "H");
    expect(errorOf(() => applyAction(g, { type: "play", placements: word("A1", "CASA", "H") }, isWord))).toEqual({ code: "not-connected" });
  });
  it("no es pot posar sobre una casella ocupada", () => {
    const g = setup("C A S A E I O");
    put(g, "H8", "CASA", "H");
    expect(errorOf(() => applyAction(g, { type: "play", placements: word("H8", "CASA", "V") }, isWord))?.code).toBe("occupied");
  });
  it("només fitxes de l'atril", () => {
    const g = setup("C A S E I O U");
    expect(errorOf(() => applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, isWord))).toEqual({ code: "not-in-rack" });
  });
  it("l'escarràs ha de dir quina fitxa representa (8, 45)", () => {
    const g = setup("? A S A E I O");
    const p = word("H8", "cASA", "H");
    p[0]!.letter = 0;
    expect(errorOf(() => applyAction(g, { type: "play", placements: p }, isWord))).toEqual({ code: "bad-blank" });
  });
  it("totes les paraules formades han de ser vàlides, també les creuades (12)", () => {
    const g = setup("S I E O U A R");
    put(g, "H8", "CASA", "H");
    // S a L8 forma CASAS (vàlida); I a L9 forma SI vertical i res més → vàlid
    expect(checkPlay(g, word("L8", "SI", "V"), isWord).ok).toBe(true);
    // E a L8: CASAE no és vàlida
    const r = checkPlay(g, word("L8", "E", "H"), isWord);
    expect(r.ok ? null : r.error).toEqual({ code: "invalid-words", words: ["CASAE"] });
  });
});

describe("puntuació (46-49)", () => {
  const isWord = dict("CASA", "CASAS", "AS", "SI", "XARXA", "CANTAVA");
  const score = (g: ReturnType<typeof setup>, p: ReturnType<typeof word>) => {
    const r = checkPlay(g, p, isWord);
    if (!r.ok) throw new Error(r.error.code);
    return r.result.score;
  };

  it("primera jugada sobre H8 (paraula doble): CASA = (2+1+1+1)×2 = 10", () => {
    expect(score(setup("C A S A E I O"), word("H8", "CASA", "H"))).toBe(10);
  });
  it("les fitxes del tauler compten pel valor facial; les noves aprofiten premis (46): CASA+S a L8 (lletra doble) = 5+2 = 7", () => {
    const g = setup("S E I O U A R");
    put(g, "H8", "CASA", "H");
    expect(score(g, word("L8", "S", "H"))).toBe(7);
  });
  it("un premi compartit per dues paraules noves s'aplica a les dues (47): S a K5 forma AS i SI = 4+4 = 8", () => {
    const g = setup("S E I O U A R");
    put(g, "J5", "A", "H");
    put(g, "K6", "I", "V");
    expect(score(g, word("K5", "S", "H"))).toBe(8);
  });
  it("primer premis de lletra, després de paraula (48): XARXA de H4 a H8 = (20+1+1+10+1)×2 = 66", () => {
    expect(score(setup("X A R X A E I"), word("H4", "XARXA", "V"))).toBe(66);
  });
  it("l'escarràs val 0 però activa el premi de paraula (8): cASA a H8 = (0+1+1+1)×2 = 6", () => {
    expect(score(setup("? A S A E I O"), word("H8", "cASA", "H"))).toBe(6);
  });
  it("7 fitxes de cop: +50 (49): CANTAVA de H8 a N8 = (2+1+1+1+1×2+4+1)×2 + 50 = 74", () => {
    const g = setup("C A N T A V A");
    const r = checkPlay(g, word("H8", "CANTAVA", "H"), isWord);
    expect(r.ok && r.result).toMatchObject({ score: 74, bingo: true });
  });
  it("jugar suma els punts, treu les fitxes de l'atril i en roba de noves (19)", () => {
    const g = setup("C A S A E I O");
    const bag = g.bag.length;
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, isWord);
    expect(n.players[0]!.score).toBe(10);
    expect(n.players[0]!.rack).toHaveLength(7);
    expect(n.bag).toHaveLength(bag - 4);
    expect(currentPlayer(n)).toBe(1);
  });
});

describe("canviar i passar (33-35)", () => {
  it("canviar exigeix almenys 7 fitxes a la bossa (34)", () => {
    const g = setup("C A S A E I O");
    g.bag = g.bag.slice(0, 6);
    expect(errorOf(() => applyAction(g, { type: "exchange", tiles: T("CA") }, dict()))).toEqual({ code: "bag-too-small" });
  });
  it("canviar conserva les fitxes, l'atril queda de 7 i passa el torn", () => {
    const g = createGame({ gameId: gameIdOf(2), seed: seedOf(2), names: ["A", "B"] });
    const p = currentPlayer(g);
    const n = applyAction(g, { type: "exchange", tiles: g.players[p]!.rack.slice(0, 3) }, dict());
    expect(tileInventoryOk(n)).toBe(true);
    expect(n.players[p]!.rack).toHaveLength(7);
    expect(n.bag).toHaveLength(g.bag.length);
    expect(currentPlayer(n)).not.toBe(p);
    expect(n.scoreless).toBe(1);
  });
  it("el resultat no depèn de l'ordre en què es trien les fitxes", () => {
    const g = createGame({ gameId: gameIdOf(2), seed: seedOf(2), names: ["A", "B"] });
    const r = g.players[g.current]!.rack;
    const a = applyAction(g, { type: "exchange", tiles: [r[0]!, r[1]!, r[2]!] }, dict());
    const b = applyAction(g, { type: "exchange", tiles: [r[2]!, r[0]!, r[1]!] }, dict());
    expect(stateHash(a)).toBe(stateHash(b));
  });
  it("no es poden canviar fitxes que no són a l'atril", () => {
    const g = setup("C A S A E I O");
    expect(errorOf(() => applyAction(g, { type: "exchange", tiles: T("XX") }, dict()))).toEqual({ code: "not-in-rack" });
  });
});

describe("final de partida (22-23)", () => {
  it("tancament: qui buida l'atril amb la bossa buida suma el valor dels atrils dels altres, que el resten", () => {
    const g = setup("C A S A", ["A", "B", "C"]);
    g.bag = [];
    g.players[1]!.rack = T("XZ"); // 18
    g.players[2]!.rack = T("EI"); // 2
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, dict("CASA"));
    expect(n.ended).toBe("closed");
    expect(n.players.map(p => p.score)).toEqual([10 + 20, -18, -2]);
  });
  it("bloqueig: 3 rondes completes sense punts; cadascú resta el seu atril", () => {
    let g = createGame({ gameId: gameIdOf(3), seed: seedOf(3), names: ["A", "B"] });
    const racks = g.players.map(p => rackValue(p.rack));
    for (let i = 0; i < 5; i++) g = applyAction(g, { type: "pass" }, dict());
    expect(g.ended).toBeNull();
    g = applyAction(g, { type: "pass" }, dict());
    expect(g.ended).toBe("blocked");
    expect(g.players.map(p => p.score)).toEqual(racks.map(v => -v));
    expect(errorOf(() => applyAction(g, { type: "pass" }, dict()))).toEqual({ code: "game-over" });
  });
});

describe("regla dels senyors (32)", () => {
  const allVowels = (r: number[]) => r.every(t => VOWELS.has(t));

  it("set vocals o set consonants sense escarràs", () => {
    expect(isSenyorsRack(T("AEIOUAE"))).toBe(true);
    expect(isSenyorsRack(T("BCDFGLM"))).toBe(true);
    expect(isSenyorsRack([...T("AEIOUA"), 0])).toBe(false);
    expect(isSenyorsRack(T("AEIOUAB"))).toBe(false);
  });

  it("es pot canviar just després de robar, sense perdre el torn, encara que quedi una sola fitxa a la bossa", () => {
    const g = setup("C A S A E I O");
    let n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, dict("CASA"));
    n.players[0]!.rack = T("AEIOUAE");
    n.bag = [...T("BCDFGLM"), ...n.bag.slice(0, 1)];
    expect(senyorsAvailable(n, 0)).toBe(true);
    expect(senyorsAvailable(n, 1)).toBe(false);
    const before = currentPlayer(n);
    n = swapSenyors(n, 0);
    expect(currentPlayer(n)).toBe(before);
    expect(n.last!.senyorsSwaps).toBe(1);
    expect(n.players[0]!.rack).toHaveLength(7);
  });

  it("tercera vegada: si tota la bossa és del mateix tipus, es queda les fitxes", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, dict("CASA"));
    n.players[0]!.rack = T("AEIOUAE");
    n.players[0]!.senyors = 2;
    n.bag = T("AEIOU");
    const r = swapSenyors(n, 0);
    expect(r.players[0]!.rack).toEqual(T("AEIOUAE"));
    expect(senyorsAvailable(r, 0)).toBe(false); // ja no es pot tornar a canviar
  });

  it("tercera vegada: si a la bossa només hi ha una fitxa diferent, se la queda i en roba sis més", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, dict("CASA"));
    n.players[0]!.rack = T("AEIOUAE");
    n.players[0]!.senyors = 2;
    n.bag = [...T("AEIOUAEIOUAE"), ...T("B")];
    const r = swapSenyors(n, 0);
    expect(r.players[0]!.rack[0]).toBe(T("B")[0]);
    expect(r.players[0]!.rack).toHaveLength(7);
  });

  it("tercera vegada: si n'hi ha dues o més de diferents, es canvia fins que en surti alguna", () => {
    const g = setup("C A S A E I O");
    const n = applyAction(g, { type: "play", placements: word("H8", "CASA", "H") }, dict("CASA"));
    n.players[0]!.rack = T("AEIOUAE");
    n.players[0]!.senyors = 2;
    n.bag = [...T("AEIOUAEIOUAEIOUAEIOU"), ...T("BC")];
    const r = swapSenyors(n, 0);
    expect(allVowels(r.players[0]!.rack)).toBe(false);
  });
});

describe("senyors a l'atril inicial: s'ofereixen a l'inici del primer torn (D-03)", () => {
  it("s'ofereix al jugador a qui toca, no es fa sol, i no passa el torn", () => {
    const g = setup("A E I O U A E");
    expect(g.players[0]!.rack).toEqual(T("AEIOUAE")); // no s'ha canviat automàticament
    expect(senyorsAtTurnStart(g, 0)).toBe(true);
    expect(senyorsAtTurnStart(g, 1)).toBe(false);
    const n = applyAction(g, { type: "senyors" }, dict());
    expect(n.current).toBe(0);
    expect(n.seq).toBe(g.seq + 1);
    expect(tileInventoryOk(n)).toBe(true);
  });
  it("després d'actuar ja no s'ofereix a l'inici del torn", () => {
    const g = setup("A E I O U A E");
    let n = applyAction(g, { type: "pass" }, dict());
    n = applyAction(n, { type: "pass" }, dict());
    n.players[0]!.rack = T("AEIOUAE");
    expect(n.current).toBe(0);
    expect(senyorsAtTurnStart(n, 0)).toBe(false);
  });
});

describe("bloqueig: només compten passar i canviar (D-05)", () => {
  it("una jugada vàlida de 0 punts (escarrassos) reinicia el comptador", () => {
    let g = setup("? ? E I O U A");
    for (let i = 0; i < 3; i++) g = applyAction(g, { type: "pass" }, dict());
    g = applyAction(g, { type: "pass" }, dict()); // torna a tocar al jugador 0? (2 jugadors: 0,1,0,1)
    expect(g.scoreless).toBe(4);
    expect(g.current).toBe(0);
    const n = applyAction(g, { type: "play", placements: word("H8", "as", "H") }, dict("AS"));
    expect(n.last!.score).toBe(0);
    expect(n.scoreless).toBe(0);
    expect(n.ended).toBeNull();
  });
});

describe("abandonar (D-13)", () => {
  it("les fitxes tornen a la bossa, se'l salta i queda fora de la classificació", () => {
    const g = setup("C A S A E I O", ["A", "B", "C"]);
    const bag = g.bag.length;
    const n = applyAction(g, { type: "leave" }, dict(), 1); // B abandona fora del seu torn
    expect(n.players[1]!.status).toBe("retired");
    expect(n.players[1]!.rack).toEqual([]);
    expect(n.bag).toHaveLength(bag + 7);
    expect(n.order).toEqual([0, 2]);
    expect(standings(n)).not.toContain(1);
    expect(tileInventoryOk(n)).toBe(true);
    const m = applyAction(n, { type: "pass" }, dict());
    expect(m.current).toBe(2);
  });
  it("si abandona qui té el torn, toca al següent", () => {
    const g = setup("C A S A E I O", ["A", "B", "C"]);
    expect(applyAction(g, { type: "leave" }, dict(), 0).current).toBe(1);
  });
  it("si només queda un jugador, la partida acaba", () => {
    const g = setup("C A S A E I O");
    expect(applyAction(g, { type: "leave" }, dict(), 1).ended).toBe("abandoned");
  });
});

describe("treure un absent per consens (D-14)", () => {
  const three = () => setup("C A S A E I O", ["A", "B", "C"]);

  it("cal el vot de tots els altres actius; qui és tret conserva els punts i la classificació", () => {
    const g = three();
    g.players[0]!.score = 120;
    g.current = 0; // l'absent (A) té el torn i la partida està encallada
    let n = applyAction(g, { type: "vote-remove", target: 0 }, dict(), 1);
    expect(n.players[0]!.status).toBe("active");
    expect(n.removal).toEqual({ target: 0, votes: [1] });
    n = applyAction(n, { type: "vote-remove", target: 0 }, dict(), 2);
    expect(n.players[0]!.status).toBe("removed");
    expect(n.players[0]!.score).toBe(120);
    expect(standings(n)[0]).toBe(0);
    expect(n.current).toBe(1);
    expect(n.removal).toBeNull();
    expect(tileInventoryOk(n)).toBe(true);
  });
  it("si l'absent torna i actua, la votació s'anul·la", () => {
    let n = applyAction(three(), { type: "vote-remove", target: 0 }, dict(), 1);
    n = applyAction(n, { type: "pass" }, dict()); // A (jugador 0) passa
    expect(n.removal).toBeNull();
  });
  it("ningú no es pot votar a si mateix ni obrir dues votacions alhora", () => {
    const g = three();
    expect(errorOf(() => applyAction(g, { type: "vote-remove", target: 1 }, dict(), 1))).toEqual({ code: "not-allowed" });
    const n = applyAction(g, { type: "vote-remove", target: 0 }, dict(), 1);
    expect(errorOf(() => applyAction(n, { type: "vote-remove", target: 2 }, dict(), 1))).toEqual({ code: "vote-in-progress" });
  });
  it("un jugador retirat o tret no pot votar ni jugar", () => {
    const n = applyAction(three(), { type: "leave" }, dict(), 2);
    expect(errorOf(() => applyAction(n, { type: "vote-remove", target: 0 }, dict(), 2))).toEqual({ code: "not-active" });
  });
});

describe("entrar a mitja partida (D-15)", () => {
  it("un jugador nou entra al final de la ronda amb la puntuació més baixa dels actius", () => {
    const g = setup("C A S A E I O", ["A", "B"]);
    g.players[0]!.score = 80;
    g.players[1]!.score = 35;
    const n = applyAction(g, { type: "join", name: "Laia" }, dict());
    expect(n.players[2]).toMatchObject({ name: "Laia", score: 35, status: "active" });
    expect(n.players[2]!.rack).toHaveLength(7);
    expect(n.order).toEqual([0, 1, 2]);
    expect(n.current).toBe(0); // acceptar no gasta el torn
    expect(tileInventoryOk(n)).toBe(true);
  });
  it("només ho accepta el mòbil de qui té el torn", () => {
    expect(errorOf(() => applyAction(setup("C A S A E I O"), { type: "join", name: "Laia" }, dict(), 1))).toEqual({ code: "not-your-turn" });
  });
  it("cal que hi hagi 7 fitxes a la bossa i com a molt 4 jugadors actius", () => {
    const g = setup("C A S A E I O");
    g.bag = g.bag.slice(0, 6);
    expect(errorOf(() => applyAction(g, { type: "join", name: "Laia" }, dict()))).toEqual({ code: "bag-too-small" });
    const full = setup("C A S A E I O", ["A", "B", "C", "D"]);
    expect(errorOf(() => applyAction(full, { type: "join", name: "Laia" }, dict()))).toEqual({ code: "table-full" });
  });
  it("qui torna entra amb el més alt entre els seus punts i la puntuació més baixa dels actius", () => {
    const g = setup("C A S A E I O", ["A", "B", "C"]);
    g.players[0]!.score = 30;
    g.players[1]!.score = 50;
    g.players[2]!.score = 10;
    let m = applyAction(g, { type: "leave" }, dict(), 1); // B (50) abandona; actius A (30) i C (10)
    m = applyAction(m, { type: "rejoin", player: 1 }, dict());
    expect(m.players[1]).toMatchObject({ status: "active", score: 50 });
    expect(m.order).toEqual([0, 2, 1]);

    let k = applyAction(g, { type: "leave" }, dict(), 2); // C (10) abandona; actius A (30) i B (50)
    k = applyAction(k, { type: "rejoin", player: 2 }, dict());
    expect(k.players[2]!.score).toBe(30);
  });
});
