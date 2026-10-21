/**
 * Pantalla de joc: tauler, atril, accions. Tot el que es fa aquí és «estat de pantalla» fins que es prem Juga.
 * Les fitxes es poden col·locar tocant (fitxa i després casella) o arrossegant (Pointer Events).
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CELLS, CENTER, PREMIUMS } from "../core/board";
import {
  applyAction, checkPlay, EngineError, senyorsAtTurnStart, senyorsAvailable, swapSenyors, type IsWord,
} from "../core/game";
import { BLANK, TILE_LABELS, TILE_VALUES, VOWELS } from "../core/tiles";
import type { Action, GameState, Placement } from "../core/types";
import { Scorebar } from "./scorebar";
import { controlCode, vibrate } from "./support";
import { errorText, points } from "./text";

const PREMIUM_LABEL = { TW: "3P", DW: "2P", TL: "3L", DL: "2L" } as const;
/** Moviment mínim (píxels) perquè un toc es consideri arrossegar. */
const DRAG_THRESHOLD = 8;
/** La fitxa arrossegada es dibuixa per sobre del dit perquè el dit no la tapi. */
const GHOST_LIFT = 44;

interface Pending { index: number; slot: number; letter: number }
type DragSource = { kind: "rack"; slot: number } | { kind: "board"; index: number };
interface Drag { source: DragSource; x: number; y: number; over: number | null; overRack: boolean }

export function TileFace({ tile, letter }: { tile: number; letter: number }) {
  const label = TILE_LABELS[letter] ?? "?";
  return (
    <>
      <span class={`l${label.length > 1 ? " long" : ""}`}>{label}</span>
      <span class="v">{tile === BLANK ? "" : TILE_VALUES[tile]}</span>
    </>
  );
}

function Board({ state, pending, bad, good, dropCell, zoom, onCell, onPendingDown }: {
  state: GameState;
  pending: Pending[];
  bad: Set<number>;
  good: boolean;
  dropCell: number | null;
  zoom: boolean;
  onCell: (i: number) => void;
  onPendingDown: (e: PointerEvent, i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useMemo(() => {
    const a = state.last?.action;
    return new Set(a?.type === "play" ? a.placements.map(p => p.index) : []);
  }, [state]);
  const rack = state.players[state.current]!.rack;
  const byCell = new Map(pending.map(p => [p.index, p]));

  // En ampliar, centra la zona on s'està jugant
  useEffect(() => {
    const box = ref.current;
    if (!box || !zoom) return;
    const focus = pending[0]?.index ?? [...last][0] ?? CENTER;
    const cell = box.querySelector<HTMLElement>(`[data-i="${focus}"]`);
    if (cell) box.scrollTo({ left: cell.offsetLeft - box.clientWidth / 2 + cell.clientWidth / 2, top: cell.offsetTop - box.clientHeight / 2 + cell.clientHeight / 2 });
  }, [zoom]);

  return (
    <div class={`board-box${zoom ? " zoom" : ""}`} ref={ref}>
      <div class="board" role="grid" aria-label="Tauler">
        {Array.from({ length: CELLS }, (_, i) => {
          const c = state.board[i];
          const p = byCell.get(i);
          const prem = PREMIUMS[i];
          const cls = [
            "cell", prem ? `p-${prem}` : "", c ? "tile" : "", c?.tile === BLANK ? "blank" : "",
            p ? "tile pending" : "", p && bad.has(i) ? "bad" : "", p && good ? "good" : "", p && rack[p.slot] === BLANK ? "blank" : "",
            last.has(i) ? "last" : "", dropCell === i && !c ? "drop" : "",
          ].join(" ");
          return (
            <div key={i} data-i={i} class={cls} onClick={() => onCell(i)}
              onPointerDown={p ? (e: PointerEvent) => onPendingDown(e, i) : undefined}>
              {c ? <TileFace tile={c.tile} letter={c.letter} />
                : p ? <TileFace tile={rack[p.slot]!} letter={p.letter} />
                : i === CENTER ? <span class="star">★</span>
                : prem ? <span class="prem">{PREMIUM_LABEL[prem]}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Modal({ children }: { children: preact.ComponentChildren }) {
  return <div class="modal-back"><div class="modal" role="dialog">{children}</div></div>;
}

export function GameScreen({ state, isWord, onCommit, onMenu }: {
  state: GameState;
  isWord: IsWord;
  onCommit: (next: GameState) => void;
  onMenu: () => void;
}) {
  const me = state.current;
  const player = state.players[me]!;
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>(() => player.rack.map((_, i) => i));
  const [zoom, setZoom] = useState(false);
  const [blankCell, setBlankCell] = useState<{ index: number; slot: number } | null>(null);
  const [exchange, setExchange] = useState<Set<number> | null>(null);
  const [confirmPass, setConfirmPass] = useState(false);
  const [offer, setOffer] = useState<GameState | null>(null); // senyors després de robar
  const [flash, setFlash] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Els gestos d'arrossegar es processen fora del cicle de Preact: necessiten l'estat més recent
  const latest = useRef({ pending, state, player });
  latest.current = { pending, state, player };
  const suppressClick = useRef(false);

  // Nou torn o nou atril: reinicia l'estat de pantalla
  useEffect(() => {
    setPending([]); setSelected(null); setExchange(null); setOffer(null); setDrag(null);
    setOrder(state.players[state.current]!.rack.map((_, i) => i));
  }, [state.seq]);

  const used = new Set(pending.map(p => p.slot));
  const placements: Placement[] = pending.map(p => ({ index: p.index, tile: player.rack[p.slot]!, letter: p.letter }));
  const check = pending.length ? checkPlay(state, placements, isWord) : null;

  // Fitxes en vermell: les de les paraules no vàlides, o totes si el problema és de posició
  const bad = new Set<number>();
  if (check && !check.ok) {
    const cells = check.error.code === "invalid-words" ? check.error.cells : pending.map(p => p.index);
    for (const c of cells) if (pending.some(p => p.index === c)) bad.add(c);
  }

  const tryApply = (action: Action): GameState | null => {
    try {
      return applyAction(state, action, isWord);
    } catch (e) {
      if (e instanceof EngineError) { setFlash(errorText(e.error)); vibrate(80); return null; }
      throw e;
    }
  };

  /** Posa una fitxa de l'atril en una casella (o obre el selector si és un escarràs). */
  const placeFromRack = (slot: number, index: number) => {
    const { pending: pend, state: st, player: pl } = latest.current;
    if (st.board[index] || pend.some(p => p.index === index) || pend.some(p => p.slot === slot)) return;
    if (pl.rack[slot] === BLANK) { setBlankCell({ index, slot }); return; }
    setPending([...pend, { index, slot, letter: pl.rack[slot]! }]);
    setSelected(null);
  };

  const onCell = (i: number) => {
    if (suppressClick.current) return;
    setFlash(null);
    if (exchange) return;
    const here = pending.find(p => p.index === i);
    if (here) { setPending(pending.filter(p => p !== here)); return; } // torna la fitxa a l'atril
    if (selected === null || state.board[i]) return;
    placeFromRack(selected, i);
  };

  const onSlot = (slot: number) => {
    if (suppressClick.current) return;
    setFlash(null);
    if (exchange) {
      const s = new Set(exchange);
      if (s.has(slot)) s.delete(slot); else s.add(slot);
      setExchange(s);
      return;
    }
    if (used.has(slot)) { setPending(pending.filter(p => p.slot !== slot)); return; }
    setSelected(selected === slot ? null : slot);
  };

  // ---- Arrossegar (Pointer Events: dit, ratolí i llapis amb el mateix codi)
  const hitTest = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y - GHOST_LIFT);
    const cell = el?.closest<HTMLElement>("[data-i]");
    return { over: cell ? Number(cell.dataset.i) : null, overRack: !!el?.closest(".rack") };
  };

  const startDrag = (e: PointerEvent, source: DragSource) => {
    if (exchange || e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
      dragging = true;
      ev.preventDefault();
      setDrag({ source, x: ev.clientX, y: ev.clientY, ...hitTest(ev.clientX, ev.clientY) });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) return; // era un toc: el gestiona onClick
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 350);
      setDrag(null);
      if (ev.type === "pointercancel") return;
      const { over, overRack } = hitTest(ev.clientX, ev.clientY);
      const { pending: pend, state: st } = latest.current;
      const free = over !== null && !st.board[over] && !pend.some(p => p.index === over);
      setFlash(null);
      if (source.kind === "rack") {
        if (free) placeFromRack(source.slot, over!);
      } else if (free) {
        setPending(pend.map(p => (p.index === source.index ? { ...p, index: over! } : p))); // mou la fitxa
      } else if (overRack || over === null) {
        setPending(pend.filter(p => p.index !== source.index)); // torna a l'atril
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const play = () => {
    const next = tryApply({ type: "play", placements });
    if (!next) return;
    if (senyorsAvailable(next, me)) setOffer(next);
    else onCommit(next);
  };

  const shuffleRack = () => {
    const o = [...order];
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j]!, o[i]!]; }
    setOrder(o);
  };

  const status = flash
    ?? (exchange ? (state.bag.length < 7 ? errorText({ code: "bag-too-small" }) : "Toca les fitxes que vols canviar.")
    : !check ? "Arrossega una fitxa al tauler, o toca la fitxa i després la casella."
    : check.ok ? `Aquesta jugada: ${points(check.result.score)} · ${check.result.words.map(w => w.letters.map(l => TILE_LABELS[l]).join("")).join(", ")}${check.result.bingo ? " · scrabble +50!" : ""}`
    : errorText(check.error));

  const startOffer = senyorsAtTurnStart(state, me) && pending.length === 0 && !exchange;
  const kind = (rack: number[]) => (rack.every(t => VOWELS.has(t)) ? "vocals" : "consonants");

  // Fitxa que s'està arrossegant (per dibuixar-la sota el dit)
  const ghost = drag && (() => {
    if (drag.source.kind === "rack") { const t = player.rack[drag.source.slot]!; return { tile: t, letter: t }; }
    const p = pending.find(q => q.index === (drag.source as { index: number }).index);
    return p ? { tile: player.rack[p.slot]!, letter: p.letter } : null;
  })();
  const dragSlot = drag?.source.kind === "rack" ? drag.source.slot : null;
  const dragCell = drag?.source.kind === "board" ? drag.source.index : null;

  return (
    <div class={`game${drag ? " dragging" : ""}`}>
      <Scorebar state={state} code={controlCode(state)} onMenu={onMenu} />
      <Board state={state} pending={pending.filter(p => p.index !== dragCell)} bad={bad} good={!!check?.ok}
        dropCell={drag?.over ?? null} zoom={zoom} onCell={onCell}
        onPendingDown={(e, i) => startDrag(e, { kind: "board", index: i })} />
      <div class={`status${check && !check.ok && !exchange ? " bad" : check?.ok ? " good" : ""}`} role="status">{status}</div>

      {startOffer && (
        <div class="banner">
          <span>Tens senyors: set {kind(player.rack)}.</span>
          <button onClick={() => { const n = tryApply({ type: "senyors" }); if (n) onCommit(n); }}>Canvia les 7 fitxes</button>
        </div>
      )}

      <div class={`rack${drag?.overRack && dragCell !== null ? " drop" : ""}`} aria-label="El teu atril">
        {order.map(slot => {
          const t = player.rack[slot];
          if (t === undefined) return null;
          const cls = ["rtile", used.has(slot) || dragSlot === slot ? "used" : "", selected === slot ? "sel" : "", exchange?.has(slot) ? "sel" : "", t === BLANK ? "blank" : ""].join(" ");
          return (
            <button key={slot} class={cls} onClick={() => onSlot(slot)} aria-label={t === BLANK ? "escarràs" : TILE_LABELS[t]}
              onPointerDown={used.has(slot) ? undefined : (e: PointerEvent) => startDrag(e, { kind: "rack", slot })}>
              <TileFace tile={t} letter={t} />
            </button>
          );
        })}
      </div>

      {exchange ? (
        <div class="actions">
          <button class="primary" disabled={exchange.size === 0 || state.bag.length < 7}
            onClick={() => { const n = tryApply({ type: "exchange", tiles: [...exchange].map(s => player.rack[s]!) }); if (n) { if (senyorsAvailable(n, me)) setOffer(n); else onCommit(n); } }}>
            Canvia {exchange.size || ""}
          </button>
          <button onClick={() => setExchange(null)}>Cancel·la</button>
        </div>
      ) : (
        <div class="actions">
          <button class="primary" disabled={!check?.ok} onClick={play}>Juga</button>
          <button onClick={() => { setPending([]); setSelected(null); }} disabled={!pending.length}>Recull</button>
          <button onClick={shuffleRack}>Barreja</button>
          <button onClick={() => { setPending([]); setSelected(null); setExchange(new Set()); }} disabled={state.bag.length < 7}>Canvia</button>
          <button onClick={() => setConfirmPass(true)}>Passa</button>
          <button onClick={() => setZoom(!zoom)} aria-pressed={zoom}>{zoom ? "Redueix" : "Amplia"}</button>
        </div>
      )}

      {drag && ghost && (
        <div class="rtile ghost" style={{ left: `${drag.x - 24}px`, top: `${drag.y - GHOST_LIFT - 26}px` }} aria-hidden="true">
          <TileFace tile={ghost.tile} letter={ghost.letter} />
        </div>
      )}

      {blankCell && (
        <Modal>
          <h2>Quina lletra fa l'escarràs?</h2>
          <div class="picker">
            {TILE_LABELS.slice(1).map((l, k) => (
              <button key={l} onClick={() => { setPending([...pending, { index: blankCell.index, slot: blankCell.slot, letter: k + 1 }]); setSelected(null); setBlankCell(null); }}>{l}</button>
            ))}
          </div>
          <button onClick={() => setBlankCell(null)}>Cancel·la</button>
        </Modal>
      )}

      {confirmPass && (
        <Modal>
          <h2>Vols passar el torn?</h2>
          <p>No jugaràs cap fitxa en aquest torn.</p>
          <div class="row">
            <button class="primary" onClick={() => { setConfirmPass(false); const n = tryApply({ type: "pass" }); if (n) onCommit(n); }}>Passa</button>
            <button onClick={() => setConfirmPass(false)}>Cancel·la</button>
          </div>
        </Modal>
      )}

      {offer && (
        <Modal>
          <h2>Tens senyors</h2>
          <p>Has robat set {kind(offer.players[me]!.rack)}. Pots canviar les 7 fitxes sense perdre el torn.</p>
          <div class="rack small">{offer.players[me]!.rack.map((t, k) => <span key={k} class="rtile"><TileFace tile={t} letter={t} /></span>)}</div>
          <div class="row">
            <button class="primary" onClick={() => { const n = swapSenyors(offer, me); if (senyorsAvailable(n, me)) setOffer(n); else { setOffer(null); onCommit(n); } }}>Canvia-les</button>
            <button onClick={() => { const n = offer; setOffer(null); onCommit(n); }}>Me les quedo</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
