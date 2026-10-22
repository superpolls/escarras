/**
 * Aplicació: pantalles i fluxos. Crear una partida, convidar (enllaç o QR), unir-s'hi, escanejar i jugar,
 * amb un o diversos jugadors per mòbil (M3, M4 i M4b).
 */
import { useEffect, useReducer, useState } from "preact/hooks";
import { activePlayers, applyAction, createGame, EngineError, MAX_NAME_CHARS, standings, type IsWord } from "../core/game";
import { TILE_LABELS } from "../core/tiles";
import type { GameState } from "../core/types";
import { sameBytes } from "../sync/bytes";
import { newGameKey } from "../sync/crypto";
import { inviteLink, PacketError, packetToText, parseInvite, textToPacket, type Packet } from "../sync/packet";
import { newReplica, replicaFromPacket, type Replica } from "../sync/replica";
import { loadSaved, readRoom, Session } from "../sync/session";
import { APP_URL, SERVER } from "./config";
import { Modal, TileFace } from "./game-screen";
import { QrCode, Scanner, useWakeLock } from "./qr";
import { askPersistence, deviceId, gameStore, pendingNames, setPendingName } from "./storage";
import { controlCode, loadLexicon, newGameId, randomBytes, vibrate } from "./support";
import { canAddPlayer, Table, type QrRequest } from "./table";
import { describeAction, errorText, netText } from "./text";
import { Info, markWelcomeSeen, Welcome, welcomeSeen } from "./info";

type Screen = "home" | "setup" | "mode" | "invite" | "draw" | "scan" | "join" | "who" | "ready" | "play" | "end" | "info";
type Confirm = { title: string; text: string; yes: string; run: () => void };

const defaultNames = (n: number) => Array.from({ length: n }, (_, i) => `Jugador ${i + 1}`);
const DEVICE = deviceId();

export function App() {
  const [isWord, setIsWord] = useState<IsWord | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [qr, setQr] = useState<QrRequest | null>(null);
  const [setupNames, setSetupNames] = useState<string[] | null>(null);
  const [joinKey, setJoinKey] = useState<Uint8Array | null>(null);
  const [whoFromQr, setWhoFromQr] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [welcomeOk, setWelcomeOk] = useState(welcomeSeen);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const force = () => bump(undefined);

  const load = () => {
    setLoadError(false);
    loadLexicon().then(lex => setIsWord(() => (t: readonly number[]) => lex.has(t))).catch(() => setLoadError(true));
  };
  useEffect(() => { load(); void askPersistence(); }, []);

  const openSession = (replica: Replica, wantSeat: number | null = null): Session => {
    session?.close();
    const s = new Session({ replica, deviceId: DEVICE, isWord: isWord!, server: SERVER, store: gameStore, describe: describeAction, wantSeat });
    s.persist();
    void s.connect();
    setSession(s);
    return s;
  };

  const closeGame = () => {
    session?.close();
    gameStore.clear();
    setSession(null);
  };

  // En arrencar: la partida desada i, si s'ha obert un enllaç d'invitació, el flux per unir-s'hi
  useEffect(() => {
    if (!isWord) return;
    const saved = gameStore.load();
    if (saved) {
      try {
        const { replica, wantSeat } = loadSaved(saved);
        openSession(replica, wantSeat);
      } catch { /* dades malmeses: es comença de nou */ }
    }
    const key = parseInvite(location.hash);
    if (key) {
      history.replaceState(null, "", location.pathname + location.search);
      setJoinKey(key);
      setScreen("join");
    }
  }, [isWord]);

  useEffect(() => {
    if (!session) return;
    const un = session.subscribe(force);
    const un2 = session.onMyTurn(() => vibrate(200));
    const kick = () => session.kick();
    const onVisible = () => { if (document.visibilityState === "visible") session.kick(); };
    window.addEventListener("online", kick);
    window.addEventListener("offline", kick);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      un(); un2();
      window.removeEventListener("online", kick);
      window.removeEventListener("offline", kick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session]);

  // Primer arranc: avís i instal·lació. L'enllaç d'invitació es conserva i continua després (D-33)
  if (!welcomeOk) return <Welcome onOk={() => { markWelcomeSeen(); setWelcomeOk(true); }} />;

  if (loadError) {
    return (
      <main class="page">
        <h1>Escarràs</h1>
        <p>No s'ha pogut carregar el diccionari. Comprova la connexió i torna-ho a provar.</p>
        <button class="primary" onClick={load}>Torna-ho a provar</button>
      </main>
    );
  }
  if (!isWord) return <main class="page"><h1>Escarràs</h1><p>Carregant el diccionari…</p></main>;

  const confirmModal = confirm && (
    <Modal>
      <h2>{confirm.title}</h2>
      <p>{confirm.text}</p>
      <div class="row">
        <button class="primary" onClick={() => { const run = confirm.run; setConfirm(null); run(); }}>{confirm.yes}</button>
        <button onClick={() => setConfirm(null)}>Cancel·la</button>
      </div>
    </Modal>
  );

  if (qr) return <QrScreen q={qr} session={session} onClose={() => setQr(null)} />;

  /** Un mòbil nou entra a la partida amb un QR (d'invitació, amb seient, o de la partida, sense). */
  const joinFromPacket = (p: Packet): string | null => {
    if (!p.key) return "Aquest codi no serveix per entrar a la partida.";
    const seats = p.seat !== null ? [p.seat] : [];
    openSession(replicaFromPacket(p.key, p, seats));
    setWhoFromQr(true);
    setScreen(seats.length ? "ready" : "who");
    return null;
  };

  /** Text llegit d'un QR o enganxat: enllaç d'invitació o codi de la partida. Torna un error per mostrar, si n'hi ha. */
  const handleCode = (text: string): string | null => {
    const key = parseInvite(text);
    if (key) { setJoinKey(key); setScreen("join"); return null; }
    let p: Packet;
    try {
      p = textToPacket(text);
    } catch (e) {
      const why = e instanceof PacketError ? e.problem : "damaged";
      return why === "not-ours" ? "Aquest codi no és del joc."
        : why === "newer" ? "Aquest codi és d'una versió més nova de l'app: cal actualitzar-la (tanca-la i torna-la a obrir amb connexió)."
        : "No s'ha llegit bé. Torna-ho a provar.";
    }
    if (!session || (session.head.ended && session.head.gameId !== p.state.gameId)) return joinFromPacket(p);
    if (session.head.gameId !== p.state.gameId) {
      setConfirm({
        title: "És d'una altra partida", text: "Aquest codi és d'una altra partida. Vols deixar la que tens en aquest mòbil i entrar en aquesta?", yes: "Sí, entra-hi",
        run: () => { const err = joinFromPacket(p); if (err) session.say(err); },
      });
      return null;
    }
    const out = session.scan(p);
    const msg: Record<string, string> = {
      same: "Ja tens aquesta jugada.",
      older: "Aquest codi és d'una jugada anterior: aquest mòbil ja va per davant.",
      kept: "Aquest mòbil té una versió més nova. Ensenya el teu QR a l'altre mòbil.",
      foreign: "Aquest codi és d'una altra partida.",
      invalid: "La jugada d'aquest codi no quadra amb la partida. Torna-ho a provar o demaneu el QR a un altre mòbil.",
    };
    if (msg[out.kind]) session.say(msg[out.kind]!);
    if (p.seat !== null && session.seatsHere.length === 0) session.takeSeats([p.seat]);
    if (!session.seatsHere.length && p.seat === null) setWhoFromQr(true); // qui mostra el QR ho consent
    setScreen(session.seatsHere.length || p.seat !== null ? "play" : "who");
    return null;
  };

  if (screen === "info") return <Info onBack={() => setScreen("home")} />;

  if (screen === "setup") {
    return <Setup initial={setupNames} onBack={() => setScreen("home")} onStart={names => {
      const state = createGame({ gameId: newGameId(), seed: randomBytes(16), names });
      openSession(newReplica(newGameKey(), state, [0]));
      setSetupNames(null);
      setScreen("mode");
    }} />;
  }

  if (screen === "scan") {
    return (
      <>
        <ScanScreen joining={!session || !!session.head.ended || session.seatsHere.length === 0} onCode={handleCode}
          onBack={() => setScreen(session && !session.head.ended ? "play" : "home")} />
        {confirmModal}
      </>
    );
  }

  if (screen === "join" && joinKey) {
    return (
      <>
        <Join joinKey={joinKey} current={session} open={replica => openSession(replica)}
          onDone={next => { setJoinKey(null); setWhoFromQr(false); setScreen(next); }}
          onScan={() => setScreen("scan")} onHome={() => { setJoinKey(null); setScreen("home"); }} ask={setConfirm} />
        {confirmModal}
      </>
    );
  }

  if (!session || screen === "home") {
    const h = session?.head;
    return (
      <main class="page home">
        <h1>Escarràs</h1>
        <p class="sub">Paraules encreuades en català</p>
        {h && !h.ended && <button class="primary big" onClick={() => setScreen("play")}>Continua la partida</button>}
        {h?.ended && <button class="big" onClick={() => setScreen("end")}>Resultat de l'última partida</button>}
        <button class={h && !h.ended ? "big" : "primary big"} onClick={() => (h && !h.ended
          ? setConfirm({ title: "Començar una partida nova?", text: "La partida d'aquest mòbil es deixarà.", yes: "Sí, nova partida", run: () => { closeGame(); setScreen("setup"); } })
          : setScreen("setup"))}>Nova partida</button>
        <button class="big" onClick={() => setScreen("scan")}>Uneix-me a una partida</button>
        <button class="link" onClick={() => setScreen("info")}>Informació i avís</button>
        {confirmModal}
      </main>
    );
  }

  const h = session.head;

  if (screen === "mode") {
    return (
      <main class="page">
        <h1>Com jugareu?</h1>
        <button class="primary big" onClick={() => setScreen("invite")}>Cadascú amb el seu mòbil</button>
        <button class="big" onClick={() => { session.takeSeats(h.players.map((_, i) => i)); setScreen("draw"); }}>Tots amb aquest mòbil</button>
        <p class="sub">També es pot barrejar: al pas següent, cada jugador pot tenir el seu mòbil o jugar amb aquest.</p>
      </main>
    );
  }

  if (screen === "invite") {
    return <Invite session={session} isWord={isWord} onQr={setQr} onDone={() => setScreen(h.turn === 0 ? "draw" : "play")} />;
  }

  if (screen === "draw") return <Draw state={h} onGo={() => setScreen("play")} />;

  if (screen === "who") {
    return <Who session={session} fromQr={whoFromQr} onDone={() => setScreen("ready")} onHome={() => setScreen("home")} />;
  }

  if (screen === "ready") return <Ready session={session} onGo={() => setScreen("play")} />;

  if (screen === "end" || h.ended) {
    return (
      <End state={h}
        onAgain={() => { setSetupNames(h.players.filter(p => p.status !== "retired").map(p => p.name).slice(0, 4)); closeGame(); setScreen("setup"); }}
        onHome={() => { closeGame(); setScreen("home"); }} />
    );
  }

  return (
    <>
      <Table session={session} isWord={isWord} onHome={() => setScreen("home")} onInvite={() => setScreen("invite")}
        onScan={() => setScreen("scan")} onQr={setQr} />
      {confirmModal}
    </>
  );
}

// ---------------------------------------------------------------- pantalles

function Setup({ initial, onStart, onBack }: { initial: string[] | null; onStart: (names: string[]) => void; onBack: () => void }) {
  const [n, setN] = useState(Math.max(2, initial?.length ?? 2));
  const [names, setNames] = useState(() => defaultNames(4).map((d, i) => initial?.[i] ?? d));
  return (
    <main class="page">
      <h1>Nova partida</h1>
      <p>Quants jugadors sou?</p>
      <div class="row choice">
        {[2, 3, 4].map(k => <button key={k} class={k === n ? "primary" : ""} onClick={() => setN(k)} aria-pressed={k === n}>{k}</button>)}
      </div>
      <p>Noms (opcional)</p>
      {names.slice(0, n).map((name, i) => (
        <input key={i} value={name} maxLength={MAX_NAME_CHARS} aria-label={`Nom del jugador ${i + 1}`}
          onFocus={e => (e.currentTarget as HTMLInputElement).select()}
          onInput={e => { const v = [...names]; v[i] = (e.currentTarget as HTMLInputElement).value; setNames(v); }} />
      ))}
      <button class="primary big" onClick={() => onStart(names.slice(0, n).map((x, i) => x.trim() || `Jugador ${i + 1}`))}>Comença</button>
      <button class="link" onClick={onBack}>Torna</button>
    </main>
  );
}

function Draw({ state, onGo }: { state: GameState; onGo: () => void }) {
  return (
    <main class="page">
      <h1>Sorteig</h1>
      <p>Cadascú treu una fitxa. Comença qui treu la més propera a l'A (l'escarràs va primer).</p>
      {state.startDraw.map((round, r) => (
        <div key={r} class="draw-round">
          {state.startDraw.length > 1 && <h2>{r === 0 ? "Primera ronda" : "Desempat"}</h2>}
          <ul class="draw">
            {round.map((t, i) => t < 0 ? null : (
              <li key={i}><span class="rtile"><TileFace tile={t} letter={t} /></span> {state.players[i]!.name}</li>
            ))}
          </ul>
        </div>
      ))}
      <p class="big-text">Comença <strong>{state.players[state.first]!.name}</strong>.</p>
      <button class="primary big" onClick={onGo}>Som-hi</button>
    </main>
  );
}

function QrScreen({ q, session, onClose }: { q: QrRequest; session: Session | null; onClose: () => void }) {
  useWakeLock();
  const h = session?.head;
  return (
    <main class="page qr-page">
      <h1>{q.title}</h1>
      <QrCode text={q.text} />
      {q.note && <p>{q.note}</p>}
      <p class="sub">Puja la brillantor de la pantalla.{h ? ` Versió ${h.seq} · codi ${controlCode(h)}.` : ""}</p>
      <button class="primary big" onClick={onClose}>Fet</button>
      {q.allowUndo && session?.canUndo() && (
        <button class="link" onClick={() => { session.undo(); onClose(); }}>M'he equivocat, desfés la jugada (només si encara no l'ha escanejat ningú)</button>
      )}
    </main>
  );
}

function ScanScreen({ joining, onCode, onBack }: { joining: boolean; onCode: (text: string) => string | null; onBack: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const submit = (t: string) => {
    const err = onCode(t);
    if (err) { setError(err); vibrate(80); setRound(r => r + 1); }
  };
  return (
    <main class="page">
      <h1>{joining ? "Uneix-me a una partida" : "Escaneja el QR"}</h1>
      <p class="sub">{joining ? "Escaneja el QR que et mostren o enganxa l'enllaç que t'han enviat." : "Apunta la càmera al QR de l'altre mòbil."}</p>
      <Scanner key={round} onRead={submit} />
      {error && <p class="status bad" role="status">{error}</p>}
      <p>O enganxa aquí l'enllaç o el codi:</p>
      <input value={text} aria-label="Enllaç o codi" placeholder="https://… o ESC1:…" onInput={e => setText((e.currentTarget as HTMLInputElement).value)} />
      <div class="row">
        {"clipboard" in navigator && (
          <button onClick={() => navigator.clipboard.readText().then(t => { setText(t); submit(t); }).catch(() => setError("No s'ha pogut llegir el porta-retalls: enganxa-ho a la casella."))}>Enganxa</button>
        )}
        <button class="primary" disabled={!text.trim()} onClick={() => submit(text)}>D'acord</button>
      </div>
      <button class="link" onClick={onBack}>Torna</button>
    </main>
  );
}

function Join({ joinKey, current, open, onDone, onScan, onHome, ask }: {
  joinKey: Uint8Array;
  current: Session | null;
  open: (r: Replica) => Session;
  onDone: (next: Screen) => void;
  onScan: () => void;
  onHome: () => void;
  ask: (c: Confirm) => void;
}) {
  const [st, setSt] = useState<"loading" | "missing" | "offline" | "asking">("loading");
  const go = async () => {
    setSt("loading");
    if (!SERVER) { setSt("offline"); return; }
    try {
      const room = await readRoom(SERVER, joinKey);
      if (!room) { setSt("missing"); return; }
      const s = open(replicaFromPacket(joinKey, room.packet, []));
      await s.connect();
      const seat = await s.autoSeat();
      onDone(seat === null ? "who" : "ready");
    } catch {
      setSt("offline");
    }
  };
  useEffect(() => {
    if (current && sameBytes(current.replica.key, joinKey)) { onDone(current.seatsHere.length ? "play" : "who"); return; }
    if (current && !current.head.ended) {
      setSt("asking");
      ask({ title: "Entrar en una altra partida?", text: "Aquest mòbil ja té una partida en marxa. Si entres en la nova, es deixarà.", yes: "Sí, entra-hi", run: () => void go() });
      return;
    }
    void go();
  }, []);
  return (
    <main class="page">
      <h1>Uneix-me a la partida</h1>
      {st === "loading" && <p>Buscant la partida…</p>}
      {st === "missing" && <p>La partida encara no és al servidor. Demana a qui l'ha creada que t'ensenyi el QR d'invitació.</p>}
      {st === "offline" && <p>Sense connexió amb el servidor. Demana a qui l'ha creada que t'ensenyi el QR d'invitació.</p>}
      {(st === "missing" || st === "offline") && (
        <>
          <button class="primary big" onClick={onScan}>Escaneja el QR</button>
          <button class="big" onClick={() => void go()}>Torna-ho a provar</button>
        </>
      )}
      <button class="link" onClick={onHome}>Inici</button>
    </main>
  );
}

function Who({ session, fromQr, onDone, onHome }: { session: Session; fromQr: boolean; onDone: () => void; onHome: () => void }) {
  const h = session.head;
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (session.seatsHere.length) onDone(); });
  const pick = async (p: number) => {
    if (fromQr || !SERVER) { session.takeSeats([p]); return; } // qui mostra el QR ho consent
    const r = await session.requestSeat(p);
    if (r === "offline") setMsg("Sense connexió. Demana a un altre jugador que t'ensenyi el codi de la partida.");
  };
  const waiting = session.wantSeat;
  return (
    <main class="page">
      <h1>Qui ets?</h1>
      {waiting !== null ? (
        <p>Esperant que un altre jugador confirmi al seu mòbil que ets <strong>{h.players[waiting]?.name}</strong>…</p>
      ) : (
        <>
          <p class="sub">{fromQr ? "Tria el teu nom." : "Tots els jugadors ja tenen mòbil. Si has canviat de mòbil, tria el teu nom i un altre jugador ho confirmarà."}</p>
          <div class="col">
            {activePlayers(h).map(p => <button key={p} class="big" onClick={() => void pick(p)}>{h.players[p]!.name}</button>)}
          </div>
        </>
      )}
      {msg && <p class="status bad">{msg}</p>}
      <button class="link" onClick={onHome}>Inici</button>
    </main>
  );
}

function Ready({ session, onGo }: { session: Session; onGo: () => void }) {
  const h = session.head;
  const me = session.seatsHere[0];
  const [name, setName] = useState(me !== undefined ? pendingNames(h.gameId)[me] ?? h.players[me]?.name ?? "" : "");
  useEffect(() => { if (me === undefined) onGo(); });
  if (me === undefined) return null;
  const go = () => {
    const n = name.trim();
    if (n && n !== h.players[me]!.name) setPendingName(h.gameId, me, n);
    onGo();
  };
  return (
    <main class="page">
      <h1>Ets {h.players[me]!.name}</h1>
      <p>Pots posar-te el teu nom. Els altres el veuran quan facis la primera jugada.</p>
      <input value={name} maxLength={MAX_NAME_CHARS} aria-label="El teu nom" onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
      <p class="sub">{h.turn === 0 ? `Pel sorteig, comença ${h.players[h.first]!.name}.` : `Ara és el torn de ${h.players[h.current]!.name}.`}</p>
      <button class="primary big" onClick={go}>Som-hi</button>
    </main>
  );
}

function Invite({ session, isWord, onQr, onDone }: { session: Session; isWord: IsWord; onQr: (q: QrRequest) => void; onDone: () => void }) {
  const h = session.head;
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const link = inviteLink(APP_URL, session.replica.key);
  const share = async () => {
    const text = "Juguem a l'Escarràs? Obre aquest enllaç per entrar a la partida:";
    const nav = navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "Escarràs", text, url: link }); } catch { /* cancel·lat */ }
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, "_blank", "noopener");
  };
  const myTurn = session.holds(h.current) && !h.proposal;
  const act = (a: Parameters<typeof applyAction>[1]) => {
    try { session.commit(applyAction(h, a, isWord)); setMsg(null); } catch (e) { if (e instanceof EngineError) setMsg(errorText(e.error)); else throw e; }
  };
  const away = h.players.map((p, i) => ({ p, i })).filter(x => x.p.status !== "active");
  return (
    <main class="page">
      <h1>Convida els jugadors</h1>
      {SERVER && (
        <>
          <p>Amb connexió, envia aquest enllaç al grup. Cada mòbil que l'obri serà el primer jugador lliure.</p>
          <button class="primary big" data-link={link} onClick={() => void share()}>Envia l'enllaç (WhatsApp…)</button>
          <p class={`net${session.net === "synced" ? " ok" : ""}`} role="status">{netText(session.net, session.pending)}</p>
          <button class="link" onClick={() => { navigator.clipboard?.writeText(link).then(() => setMsg("Enllaç copiat."), () => setMsg(link)); }}>Copia l'enllaç</button>
        </>
      )}
      <p>Sense connexió, cada jugador escaneja el seu QR des de l'app («Uneix-me a una partida»).</p>
      <ul class="seats">
        {h.players.map((p, i) => p.status !== "active" ? null : (
          <li key={i}>
            <span class="name">{p.name}</span>
            {session.holds(i) ? <span class="sub">aquest mòbil</span>
              : session.seats[i] ? <span class="ok">té mòbil ✓</span>
              : (
                <span class="row">
                  <button onClick={() => onQr({ text: packetToText(session.qrPacket(i)), title: `Invitació per a ${p.name}`, note: `Escaneja'l amb el mòbil de ${p.name}, des de «Uneix-me a una partida».` })}>QR</button>
                  <button onClick={() => session.takeSeats([i])}>Amb aquest mòbil</button>
                </span>
              )}
          </li>
        ))}
      </ul>
      {h.turn > 0 && canAddPlayer(h) && (
        myTurn ? (
          <div class="add">
            <p>Afegir un jugador (entrarà al final de la ronda):</p>
            <div class="row">
              <input value={newName} maxLength={MAX_NAME_CHARS} placeholder="Nom" aria-label="Nom del jugador nou" onInput={e => setNewName((e.currentTarget as HTMLInputElement).value)} />
              <button disabled={!newName.trim()} onClick={() => { act({ type: "join", name: newName.trim() }); setNewName(""); }}>Afegeix</button>
            </div>
            {away.map(({ p, i }) => <button key={i} onClick={() => act({ type: "rejoin", player: i })}>Torna a entrar: {p.name}</button>)}
          </div>
        ) : <p class="sub">Per afegir un jugador, ho ha de fer el mòbil de qui té el torn.</p>
      )}
      {msg && <p class="status">{msg}</p>}
      <button class="primary big" onClick={onDone}>Som-hi</button>
    </main>
  );
}

function End({ state, onAgain, onHome }: { state: GameState; onAgain: () => void; onHome: () => void }) {
  const ranking = standings(state);
  const best = state.players[ranking[0]!]!.score;
  const winners = ranking.filter(i => state.players[i]!.score === best).map(i => state.players[i]!.name);
  const retired = state.players.filter(p => p.status === "retired");
  return (
    <main class="page end">
      <h1>{winners.length > 1 ? `Empat: ${winners.join(" i ")}` : `Guanya ${winners[0]}!`}</h1>
      <p>{state.ended === "closed" ? "Partida tancada: s'han sumat i restat les fitxes dels atrils." : state.ended === "blocked" ? "Partida bloquejada: cadascú resta les fitxes del seu atril." : "Partida acabada per abandonament."}</p>
      <ol class="ranking">
        {ranking.map(i => <li key={i}><span>{state.players[i]!.name}{state.players[i]!.status === "removed" ? " (absent)" : ""}</span><strong>{state.players[i]!.score}</strong></li>)}
      </ol>
      {retired.length > 0 && <p class="sub">Retirats: {retired.map(p => `${p.name} (${p.score})`).join(", ")}</p>}
      {state.approvedWords.length > 0 && (
        <p class="sub">Paraules aprovades en aquesta partida: <strong>{state.approvedWords.map(w => w.map(t => TILE_LABELS[t]).join("")).join(", ")}</strong>. Si són correctes, es poden afegir al diccionari.</p>
      )}
      <button class="primary big" onClick={onAgain}>Revenja amb els mateixos jugadors</button>
      <button class="link" onClick={onHome}>Inici</button>
    </main>
  );
}
