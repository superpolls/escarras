/**
 * La partida en marxa en aquest mòbil, amb un o diversos jugadors (M4/M4b).
 * Decideix què es veu: el torn propi, el traspàs entre jugadors del mateix mòbil o l'espera,
 * i els avisos comuns (votacions, propostes, peticions de seient, conflictes).
 */
import { useEffect, useState } from "preact/hooks";
import { activePlayers, applyAction, checkPlay, cleanName, EngineError, MAX_ACTIVE, proposalApprover, type IsWord } from "../core/game";
import { TILE_LABELS } from "../core/tiles";
import type { Action, GameState, Placement } from "../core/types";
import { packetToText } from "../sync/packet";
import { previousOf } from "../sync/replica";
import type { Session } from "../sync/session";
import { Board, GameScreen, Modal, TileFace } from "./game-screen";
import { Scorebar } from "./scorebar";
import { pendingNames, setPendingName } from "./storage";
import { controlCode, vibrate } from "./support";
import { describeAction, dictionaryText, errorText, netText, points } from "./text";

/** done: text del botó per tornar al joc. Quan es passa el torn, diu que l'altre ja l'ha escanejat (D-39). */
export interface QrRequest { text: string; title: string; note?: string; allowUndo?: boolean; done?: string; handoff?: boolean }

/** QR de traspàs de torn ja ensenyat en aquesta versió de la partida, confirmat o no (D-40). */
export interface Handoff { gameId: string; seq: number; q: QrRequest; confirmed: boolean }

const wordsOf = (s: GameState, placements: readonly Placement[], isWord: IsWord, onlyUnknown: boolean) => {
  const c = checkPlay(s, placements, onlyUnknown ? isWord : () => true);
  if (c.ok) return c.result.words.map(w => w.letters.map(l => TILE_LABELS[l]).join(""));
  return c.error.code === "invalid-words" ? c.error.words : [];
};

export function LastMove({ session }: { session: Session }) {
  const s = session.head;
  const last = s.last;
  if (!last) return null;
  const prev = previousOf(session.replica);
  const who = s.players[last.player]?.name ?? "";
  const a = last.action;
  let text: string;
  if (a.type === "play" && prev) {
    text = `${who} ha jugat ${wordsOf(prev, a.placements, () => true, false).join(", ")} · ${points(last.score)}`;
  } else if (a.type === "approve" && prev?.proposal) {
    const mover = s.players[prev.proposal.player]?.name ?? "";
    text = `${mover} ha jugat ${wordsOf(prev, prev.proposal.placements, () => true, false).join(", ")} (l'ha acceptada ${who}) · ${points(last.score)}`;
  } else {
    text = describeAction(s, last);
  }
  if (last.senyorsSwaps) text += " i ha canviat senyors";
  return <p class="last-move">{text}</p>;
}

export function Table({ session, isWord, onHome, onInvite, onScan, onQr, handoff }: {
  session: Session;
  isWord: IsWord;
  onHome: () => void;
  onInvite: () => void;
  onScan: () => void;
  onQr: (q: QrRequest) => void;
  handoff: Handoff | null;
}) {
  const h = session.head;
  const seats = session.seatsHere;
  const multi = seats.length > 1;
  const [viewer, setViewer] = useState<number | null>(null);
  /** Diversos jugadors en aquest mòbil i no els toca: qui mira les seves fitxes per provar jugades (D-42). */
  const [peek, setPeek] = useState<number | null>(null);
  const [menu, setMenu] = useState<null | "main" | "rename" | "remove" | "leave">(null);
  const [zoom, setZoom] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const name = (p: number) => h.players[p]?.name ?? "";
  const net = netText(session.net, session.pending);

  useEffect(() => { setFlash(null); setPeek(null); }, [h.seq]); // cada jugada nova amaga les fitxes

  const approver = h.proposal ? proposalApprover(h) : null;
  const approverMine = approver !== null && session.holds(approver);
  const proposerMine = !!h.proposal && session.holds(h.proposal.player);
  const myTurn = !h.ended && session.holds(h.current) && !h.proposal;

  /** Desa una acció d'aquest mòbil; el nom nou del jugador hi viatja (D-08). */
  const commit = (next: GameState) => {
    const actor = next.last?.player;
    if (actor !== undefined) {
      const nm = pendingNames(h.gameId)[actor];
      if (nm) {
        try { next.players[actor]!.name = cleanName(nm); } catch { /* nom buit: s'ignora */ }
        setPendingName(h.gameId, actor, null);
      }
    }
    session.commit(next);
    after();
  };

  /** Després d'una acció: si qui ha de seguir no és en aquest mòbil i no hi ha connexió, cal el QR. */
  const after = () => {
    const n = session.head;
    if (n.ended) return;
    const target = n.proposal ? proposalApprover(n) : n.current;
    if (target === null || session.holds(target)) { vibrate(); return; }
    if (session.net !== "synced" || navigator.onLine === false) {
      onQr({
        text: packetToText(session.qrPacket()),
        title: `Passa-ho a: ${n.players[target]?.name ?? ""}`,
        note: n.proposal ? "Que escanegi aquest codi per acceptar o no la paraula." : "Que escanegi aquest codi i li tocarà.",
        allowUndo: true,
        handoff: true,
        done: `${n.players[target]?.name ?? ""} ja l'ha escanejat`,
      });
    }
  };

  const act = (action: Action, actor: number) => {
    try {
      commit(applyAction(h, action, isWord, actor));
      setMenu(null);
    } catch (e) {
      if (e instanceof EngineError) { setFlash(errorText(e.error)); vibrate(80); setMenu(null); return; }
      throw e;
    }
  };

  // ---------------------------------------------------------------- avisos comuns
  const removal = h.removal;
  const missingVotes = removal ? activePlayers(h).filter(p => p !== removal.target && !removal.votes.includes(p)) : [];
  const myVoters = missingVotes.filter(p => session.holds(p));
  const proposalWords = h.proposal ? wordsOf(h, h.proposal.placements, isWord, true) : [];
  // A qui s'ha de passar la jugada i si el QR d'aquesta versió ja s'ha ensenyat (D-40)
  const passTo = h.proposal ? approver ?? h.current : h.current;
  const thisHandoff = handoff && handoff.gameId === h.gameId && handoff.seq === h.seq ? handoff : null;
  const unconfirmed = !!thisHandoff && !thisHandoff.confirmed && !session.holds(passTo);

  const banners = (
    <>
      {session.notices.map(n => (
        <div key={n.id} class="banner notice"><span>{n.text}</span><button class="x" aria-label="Tanca" onClick={() => session.dismissNotice(n.id)}>✕</button></div>
      ))}
      {flash && <div class="banner notice"><span>{flash}</span><button class="x" aria-label="Tanca" onClick={() => setFlash(null)}>✕</button></div>}
      {removal && (
        <div class="banner">
          <span>Votació per treure {name(removal.target)}. {missingVotes.length ? `Falta: ${missingVotes.map(name).join(", ")}.` : ""}</span>
          {myVoters.map(p => <button key={p} onClick={() => act({ type: "vote-remove", target: removal.target }, p)}>{multi ? `${name(p)}: hi estic d'acord` : "Hi estic d'acord"}</button>)}
        </div>
      )}
      {unconfirmed && (
        <div class="banner">
          <span>{name(passTo)} encara no ha escanejat la jugada.</span>
          <button onClick={() => onQr({ ...handoff!.q, text: packetToText(session.qrPacket()) })}>Mostra el QR</button>
        </div>
      )}
      {!thisHandoff && session.pending && (session.net === "pending" || session.net === "offline") && h.last && session.holds(h.last.player) && !session.holds(h.current) && (
        <div class="banner">
          <span>No s'ha pogut enviar. Ensenya el QR a {name(h.proposal ? approver ?? h.current : h.current)}.</span>
          <button onClick={() => onQr({ text: packetToText(session.qrPacket()), title: `Passa-ho a: ${name(passTo)}`, allowUndo: true, handoff: true, done: `${name(passTo)} ja l'ha escanejat` })}>Mostra el QR</button>
        </div>
      )}
      {h.proposal && proposerMine && !approverMine && (
        <div class="banner">
          <span>Esperant que {approver !== null ? name(approver) : "el següent"} accepti {proposalWords.join(", ")}.</span>
          <button onClick={() => act({ type: "reject" }, h.proposal!.player)}>Retira-la</button>
        </div>
      )}
    </>
  );

  // ---------------------------------------------------------------- finestres que mana el mòbil
  const claim = session.claimsToConfirm[0];
  const overlays = (
    <>
      {claim && (
        <Modal>
          <h2>Algú vol entrar com a {name(claim.seat)}</h2>
          <p>Un altre mòbil vol portar {name(claim.seat)}. Ho confirmes només si és la persona de debò (per exemple, perquè ha canviat de mòbil).</p>
          <div class="row">
            <button class="primary" onClick={() => void session.answerClaim(claim.device, claim.seat, true)}>Sí, és {name(claim.seat)}</button>
            <button onClick={() => void session.answerClaim(claim.device, claim.seat, false)}>No</button>
          </div>
        </Modal>
      )}
      {h.proposal && approverMine && approver !== null && (
        <Modal>
          <h2>{name(approver)}, acceptes {proposalWords.length === 1 ? "la paraula" : "les paraules"}?</h2>
          <p>{name(h.proposal.player)} vol jugar <strong>{proposalWords.join(", ")}</strong>, que no {proposalWords.length === 1 ? "és" : "són"} al diccionari. Si l'acceptes, la jugada val i la paraula servirà per a la resta de la partida.</p>
          <div class="row">
            <button class="primary" onClick={() => act({ type: "approve" }, approver)}>Sí, l'accepto</button>
            <button onClick={() => act({ type: "reject" }, approver)}>No</button>
          </div>
        </Modal>
      )}
      {menu === "main" && (
        <Modal>
          <h2>Menú</h2>
          <p class="sub">{dictionaryText(h)}</p>
          <div class="col">
            <button onClick={() => { setMenu(null); onScan(); }}>Escaneja un codi</button>
            <button onClick={() => { setMenu(null); onQr({ text: packetToText(session.qrPacket()), title: "QR de la partida", note: "Qui l'escanegi es posarà al dia, si aquest mòbil va més avançat. Un mòbil nou hi podrà triar quin jugador és." }); }}>Torna a mostrar el QR (posar al dia un mòbil)</button>
            <button onClick={() => { setMenu(null); onInvite(); }}>Convida o afegeix jugadors</button>
            {seats.some(p => h.players[p]?.status === "active") && <button onClick={() => setMenu("rename")}>Canvia el meu nom</button>}
            {!removal && activePlayers(h).length > 2 && seats.some(p => h.players[p]?.status === "active") && <button onClick={() => setMenu("remove")}>Treu un jugador absent</button>}
            {seats.some(p => h.players[p]?.status === "active") && <button onClick={() => setMenu("leave")}>Abandona la partida</button>}
            <button onClick={() => { setMenu(null); onHome(); }}>Torna a l'inici (la partida queda desada)</button>
            <button class="primary" onClick={() => setMenu(null)}>Continua</button>
          </div>
        </Modal>
      )}
      {menu === "rename" && <RenameModal session={session} onClose={() => setMenu(null)} />}
      {menu === "remove" && (
        <Modal>
          <h2>Treure un jugador absent</h2>
          <p>Cal que hi estiguin d'acord tots els altres jugadors, cadascú des del seu mòbil. Conserva els punts. Si torna a jugar, la votació s'anul·la.</p>
          <div class="col">
            {activePlayers(h).filter(p => !session.holds(p)).map(p => {
              const voter = seats.find(s => h.players[s]?.status === "active");
              return <button key={p} disabled={voter === undefined} onClick={() => act({ type: "vote-remove", target: p }, voter!)}>{name(p)}</button>;
            })}
            <button onClick={() => setMenu(null)}>Cancel·la</button>
          </div>
        </Modal>
      )}
      {menu === "leave" && (
        <Modal>
          <h2>Abandonar la partida?</h2>
          <p>Les fitxes tornen a la bossa. Els punts es veuran, però fora de la classificació.</p>
          <div class="col">
            {seats.filter(p => h.players[p]?.status === "active").map(p => (
              <button key={p} class="primary" onClick={() => act({ type: "leave" }, p)}>{multi ? `Abandona: ${name(p)}` : "Sí, abandono"}</button>
            ))}
            <button onClick={() => setMenu(null)}>Cancel·la</button>
          </div>
        </Modal>
      )}
    </>
  );

  // ---------------------------------------------------------------- conflicte
  if (session.conflict) {
    const theirs = session.conflict.state;
    const say = (s: GameState) => (s.last ? `${describeAction(s, s.last)}${s.last.score ? ` (${points(s.last.score)})` : ""}` : "inici de la partida");
    return (
      <main class="page">
        <h1>Hi ha dues versions d'aquesta jugada</h1>
        <p>Dos mòbils han continuat la partida de maneres diferents. Parleu-ne i trieu-ne una (l'altre mòbil haurà de triar la mateixa).</p>
        <div class="col">
          <button class="big" onClick={() => session.resolveConflict(false)}>Aquest mòbil: {say(h)}</button>
          <button class="big" onClick={() => session.resolveConflict(true)}>L'altre mòbil: {say(theirs)}</button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------- torn propi
  if (myTurn && (!multi || viewer === h.current)) {
    const next = h.order[(h.order.indexOf(h.current) + 1) % h.order.length]!;
    return (
      <>
        <GameScreen state={h} isWord={isWord} onCommit={commit} onMenu={() => setMenu("main")} approverHere={session.holds(next)} net={net}
          me={h.current} mode="turn"
          banners={<>{h.last && h.last.player !== h.current && <LastMove session={session} />}{banners}</>} />
        {overlays}
      </>
    );
  }

  // ---------------------------------------------------------------- traspàs dins el mateix mòbil
  if (myTurn && multi) {
    const last = h.last;
    return (
      <main class="page handoff">
        {banners}
        {last && <LastMove session={session} />}
        <h1>Passa el mòbil a<br /><span class="who">{name(h.current)}</span></h1>
        <button class="primary big" onClick={() => setViewer(h.current)}>Sóc {name(h.current)}</button>
        {session.canUndo() && last && (
          <button class="link" onClick={() => { session.undo(); setViewer(last.player); }}>{name(last.player)}: m'he equivocat, desfés la jugada</button>
        )}
        {overlays}
      </main>
    );
  }

  // ---------------------------------------------------------------- espera
  const single = seats.length === 1 ? seats[0]! : null;
  const rack = single !== null ? h.players[single]?.rack ?? [] : [];
  // Sense connexió (o sense servidor), la jugada només pot arribar per QR
  const offline = session.net === "offline" || session.net === "pending" || session.net === "none" || navigator.onLine === false;
  const waiting = h.ended ? "La partida s'ha acabat."
    : seats.length === 0 ? (session.wantSeat !== null ? `Esperant que un altre jugador confirmi que ets ${name(session.wantSeat)}…` : "Aquest mòbil encara no porta cap jugador.")
    : h.proposal ? (approverMine || proposerMine ? "" : `${name(h.proposal.player)} ha demanat a ${approver !== null ? name(approver) : "el següent"} que accepti una paraula.`)
    : `Torn: ${name(h.current)}.${offline ? "" : " La jugada t'arribarà sola."}`;
  // Amb connexió la jugada arriba sola: els botons de QR només surten sense connexió (al menú hi són sempre)
  const scanBtn = offline ? <button class="primary" onClick={onScan}>Sense connexió: escaneja el QR quan et toqui</button> : null;
  const showBtn = offline ? <button onClick={() => onQr({ text: packetToText(session.qrPacket()), title: `Ensenya-ho a ${name(h.current)}`, note: "Així tindrà la partida al dia.", handoff: !!h.last && session.holds(h.last.player), done: `${name(h.current)} ja l'ha escanejat` })}>Torna a mostrar el meu QR</button> : null;
  const undoBtn = session.canUndo() && h.last ? <button onClick={() => { session.undo(); after(); }}>Desfés</button> : null;

  // Un sol jugador en aquest mòbil: mentre espera, pot ordenar l'atril i provar jugades (no compten)
  if (single !== null && h.players[single]?.status === "active" && !(h.proposal && proposerMine)) {
    return (
      <>
        <GameScreen state={h} isWord={isWord} onCommit={commit} onMenu={() => setMenu("main")} approverHere={false} net={net}
          me={single} mode="draft" waitText={waiting || undefined}
          banners={<><LastMove session={session} />{banners}</>}
          waitActions={<>{scanBtn}{showBtn}{undoBtn}</>} />
        {overlays}
      </>
    );
  }

  // Diversos jugadors en aquest mòbil: cadascú pot mirar les seves fitxes i provar jugades, d'un en un (D-42)
  const peekers = multi && !h.ended ? seats.filter(p => h.players[p]?.status === "active" && !(h.proposal && h.proposal.player === p)) : [];
  if (peek !== null && peekers.includes(peek)) {
    return (
      <>
        <GameScreen key={peek} state={h} isWord={isWord} onCommit={commit} onMenu={() => setMenu("main")} approverHere={false} net={net}
          me={peek} mode="draft" waitText={`Fitxes de ${name(peek)}${waiting ? ` · ${waiting}` : ""}`}
          banners={<><LastMove session={session} />{banners}</>}
          waitActions={<>{scanBtn}{showBtn}{undoBtn}<button onClick={() => setPeek(null)}>Amaga les fitxes</button></>} />
        {overlays}
      </>
    );
  }

  return (
    <div class="game">
      <Scorebar state={h} code={controlCode(h)} onMenu={() => setMenu("main")} net={net} />
      <LastMove session={session} />
      {banners}
      <Board state={h} pending={[]} bad={new Set()} good={false} dropCell={null} zoom={zoom} onCell={() => {}} onPendingDown={() => {}}
        proposed={h.proposal?.placements ?? []} />
      <p class="status" role="status">{waiting}</p>
      {rack.length > 0 && <div class="rack small" aria-label="El teu atril">{rack.map((t, k) => <span key={k} class="rtile"><TileFace tile={t} letter={t} /></span>)}</div>}
      <div class="actions">
        {scanBtn}
        {showBtn}
        {peekers.map(p => <button key={`peek${p}`} onClick={() => setPeek(p)}>Fitxes de {name(p)}</button>)}
        <button onClick={() => setZoom(!zoom)} aria-pressed={zoom}>{zoom ? "Redueix" : "Amplia"}</button>
        {undoBtn}
      </div>
      {overlays}
    </div>
  );
}

function RenameModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const h = session.head;
  const mine = session.seatsHere.filter(p => h.players[p]?.status === "active");
  const [who, setWho] = useState(mine[0] ?? 0);
  const [text, setText] = useState(pendingNames(h.gameId)[who] ?? h.players[who]?.name ?? "");
  return (
    <Modal>
      <h2>Canvia el nom</h2>
      {mine.length > 1 && (
        <div class="row choice">
          {mine.map(p => <button key={p} class={p === who ? "primary" : ""} onClick={() => { setWho(p); setText(h.players[p]!.name); }}>{h.players[p]!.name}</button>)}
        </div>
      )}
      <input value={text} maxLength={12} aria-label="Nom nou" onInput={e => setText((e.currentTarget as HTMLInputElement).value)} />
      <p class="sub">Els altres el veuran quan facis la propera jugada.</p>
      <div class="row">
        <button class="primary" disabled={!text.trim()} onClick={() => { setPendingName(h.gameId, who, text.trim()); onClose(); }}>Desa</button>
        <button onClick={onClose}>Cancel·la</button>
      </div>
    </Modal>
  );
}

/** Quants jugadors més poden entrar ara (D-15). */
export const canAddPlayer = (s: GameState) => activePlayers(s).length < MAX_ACTIVE && s.bag.length >= 7 && s.players.length < 8 && !s.ended;
