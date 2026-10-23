/**
 * Pantalla de joc: tauler, atril, accions. Tot el que es fa aquí és «estat de pantalla» fins que es prem Juga.
 * Les fitxes es poden col·locar tocant (fitxa i després casella) o arrossegant (Pointer Events).
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CELLS, CENTER, colOf, PREMIUMS, rowOf } from "../core/board";
import {
  applyAction, checkPlay, EngineError, nextPlayer, proposalApprover, senyorsAtTurnStart, senyorsAvailable, swapSenyors, type IsWord,
} from "../core/game";
import { BLANK, TILE_LABELS, TILE_VALUES, VOWELS } from "../core/tiles";
import type { Action, GameState, Placement } from "../core/types";
import { Scorebar } from "./scorebar";
import { loadArrangement, loadDraft, saveArrangement, saveDraft } from "./storage";
import { controlCode, vibrate } from "./support";
import { errorText, points } from "./text";

const PREMIUM_LABEL = { TW: "3P", DW: "2P", TL: "3L", DL: "2L" } as const;
/** Moviment mínim (píxels) perquè un toc es consideri arrossegar. */
const DRAG_THRESHOLD = 8;
/** La fitxa arrossegada es dibuixa per sobre del dit perquè el dit no la tapi. */
const GHOST_LIFT = 44;

interface Pending { index: number; slot: number; letter: number }
type DragSource = { kind: "rack"; slot: number } | { kind: "board"; index: number };
interface Drag { source: DragSource; x: number; y: number; over: number | null; overRack: boolean; insert: number | null }

/** Ordre de l'atril: el que el jugador s'havia preparat, i les fitxes noves al final. */
function arrangedOrder(st: GameState, me: number): number[] {
  const rack = st.players[me]!.rack;
  const saved = loadArrangement(st.gameId, me) ?? [];
  const order: number[] = [];
  for (const t of saved) {
    const slot = rack.findIndex((x, i) => x === t && !order.includes(i));
    if (slot >= 0) order.push(slot);
  }
  rack.forEach((_, i) => { if (!order.includes(i)) order.push(i); });
  return order;
}

/**
 * Fitxes de prova desades, sobre el tauler i l'atril d'ara. Les que cauen sobre una fitxa nova
 * (o que ja no són a l'atril) tornen a l'atril; les altres es queden on eren.
 */
function fromDraft(st: GameState, me: number): { pending: Pending[]; dropped: number } {
  const rack = st.players[me]?.rack ?? [];
  const used = new Set<number>();
  const pending: Pending[] = [];
  let dropped = 0;
  if (st.ended) return { pending, dropped };
  for (const d of loadDraft(st.gameId, me)) {
    const slot = rack.findIndex((t, i) => t === d.tile && !used.has(i));
    if (st.board[d.index] || pending.some(p => p.index === d.index) || slot < 0) { dropped += 1; continue; }
    used.add(slot);
    pending.push({ index: d.index, slot, letter: d.letter });
  }
  return { pending, dropped };
}

/** Mou un element d'una llista a una altra posició. */
const moveTo = (list: number[], item: number, at: number) => {
  const rest = list.filter(x => x !== item);
  rest.splice(Math.max(0, Math.min(at, rest.length)), 0, item);
  return rest;
};

export function TileFace({ tile, letter }: { tile: number; letter: number }) {
  const label = TILE_LABELS[letter] ?? "?";
  return (
    <>
      <span class={`l${label.length > 1 ? " long" : ""}`}>{label}</span>
      <span class="v">{tile === BLANK ? "" : TILE_VALUES[tile]}</span>
    </>
  );
}

export function Board({ state, pending, bad, good, dropCell, zoom, onCell, onPendingDown, proposed = [], me = state.current, draft = false }: {
  state: GameState;
  pending: Pending[];
  bad: Set<number>;
  good: boolean;
  dropCell: number | null;
  zoom: boolean;
  onCell: (i: number) => void;
  onPendingDown: (e: PointerEvent, i: number) => void;
  /** Fitxes d'una jugada pendent d'aprovació (D-21), per veure-la al tauler. */
  proposed?: Placement[];
  /** Jugador de qui són les fitxes que es col·loquen. */
  me?: number;
  /** Jugada de prova, fora del torn: es pinta d'un altre color. */
  draft?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useMemo(() => {
    const a = state.last?.action;
    return new Set(a?.type === "play" ? a.placements.map(p => p.index) : []);
  }, [state]);
  const rack = state.players[me]!.rack;
  const byCell = new Map(pending.map(p => [p.index, p]));
  const shown = new Map(proposed.map(p => [p.index, p]));

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
          const q = shown.get(i);
          const prem = PREMIUMS[i];
          const cls = [
            "cell", prem ? `p-${prem}` : "", c ? "tile" : "", c?.tile === BLANK ? "blank" : "",
            p ? "tile pending" : "", p && draft ? "draft" : "", p && bad.has(i) ? "bad" : "", p && good ? "good" : "", p && rack[p.slot] === BLANK ? "blank" : "",
            last.has(i) ? "last" : "", dropCell === i && !c ? "drop" : "", q && !c ? "tile proposed" : "",
          ].join(" ");
          return (
            <div key={i} data-i={i} class={cls} onClick={() => onCell(i)}
              onPointerDown={p ? (e: PointerEvent) => onPendingDown(e, i) : undefined}>
              {c ? <TileFace tile={c.tile} letter={c.letter} />
                : p ? <TileFace tile={rack[p.slot]!} letter={p.letter} />
                : q ? <TileFace tile={q.tile} letter={q.letter} />
                : i === CENTER ? <span class="star">★</span>
                : prem ? <span class="prem">{PREMIUM_LABEL[prem]}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mida de la lupa (píxels) i caselles que hi caben per costat. */
const LOUPE = 160;
const LOUPE_CELLS = 5;

/**
 * Lupa mentre s'arrossega: les caselles del voltant, ampliades, amb la casella on cauria la fitxa marcada
 * (en vermell si està ocupada). Es dibuixa per sobre del dit perquè el dit no la tapi.
 */
function Loupe({ state, pending, rack, target, tile, x, y, draft }: {
  state: GameState;
  pending: Pending[];
  rack: number[];
  target: number;
  tile: { tile: number; letter: number };
  x: number;
  y: number;
  draft: boolean;
}) {
  const half = Math.floor(LOUPE_CELLS / 2);
  const r0 = Math.min(Math.max(rowOf(target) - half, 0), 15 - LOUPE_CELLS);
  const c0 = Math.min(Math.max(colOf(target) - half, 0), 15 - LOUPE_CELLS);
  const byCell = new Map(pending.map(p => [p.index, p]));
  const left = Math.min(Math.max(x - LOUPE / 2, 4), window.innerWidth - LOUPE - 4);
  const above = y - GHOST_LIFT - 40 - LOUPE;
  const top = above >= 4 ? above : y + 30; // si no hi cap a sobre, a sota del dit
  const cells = [];
  for (let dr = 0; dr < LOUPE_CELLS; dr++) {
    for (let dc = 0; dc < LOUPE_CELLS; dc++) {
      const i = (r0 + dr) * 15 + c0 + dc;
      const c = state.board[i];
      const p = byCell.get(i);
      const prem = PREMIUMS[i];
      const isTarget = i === target;
      const cls = ["lc", prem ? `p-${prem}` : "", c ? "tile" : "", p ? "tile pending" : "", p && draft ? "draft" : "",
        isTarget ? (c || p ? "target busy" : "target") : ""].join(" ");
      cells.push(
        <div key={i} class={cls}>
          {isTarget && !c && !p ? <TileFace tile={tile.tile} letter={tile.letter} />
            : c ? <TileFace tile={c.tile} letter={c.letter} />
            : p ? <TileFace tile={rack[p.slot]!} letter={p.letter} />
            : i === CENTER ? <span class="star">★</span>
            : prem ? <span class="prem">{PREMIUM_LABEL[prem]}</span> : null}
        </div>,
      );
    }
  }
  return <div class="loupe" style={{ left: `${left}px`, top: `${top}px` }} aria-hidden="true">{cells}</div>;
}

export function Modal({ children }: { children: preact.ComponentChildren }) {
  return <div class="modal-back"><div class="modal" role="dialog">{children}</div></div>;
}

export function GameScreen({ state, isWord, onCommit, onMenu, approverHere, net, banners, me = state.current, mode = "turn", waitText, waitActions }: {
  state: GameState;
  isWord: IsWord;
  onCommit: (next: GameState) => void;
  onMenu: () => void;
  /** El jugador que ha d'acceptar una paraula és en aquest mateix mòbil (D-21). */
  approverHere: boolean;
  net?: string;
  banners?: preact.ComponentChildren;
  /** Jugador d'aquest mòbil (per defecte, a qui toca). */
  me?: number;
  /** "draft": encara no és el seu torn; pot ordenar l'atril i provar jugades que no compten. */
  mode?: "turn" | "draft";
  waitText?: string;
  waitActions?: preact.ComponentChildren;
}) {
  const draftMode = mode === "draft";
  // Per validar una prova fora del torn, es mira com si ja li toqués
  const view = useMemo(() => (draftMode ? { ...state, current: me } : state), [state, me, draftMode]);
  const player = state.players[me]!;
  // Nou torn, atril o tauler: les fitxes de prova es tornen a situar; només tornen a l'atril les que trepitgen
  const turnKey = `${state.gameId}:${me}:${player.rack.join(",")}:${state.board.filter(Boolean).length}:${state.ended ?? ""}`;
  const [held, setHeld] = useState(() => ({ key: turnKey, pending: fromDraft(state, me).pending }));
  const pending = held.key === turnKey ? held.pending : fromDraft(state, me).pending;
  const [selected, setSelected] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>(() => arrangedOrder(state, me));
  const [zoom, setZoom] = useState(false);
  const [blankCell, setBlankCell] = useState<{ index: number; slot: number } | null>(null);
  const [exchange, setExchange] = useState<Set<number> | null>(null);
  const [confirmPass, setConfirmPass] = useState(false);
  const [offer, setOffer] = useState<GameState | null>(null); // senyors després de robar
  const [flash, setFlash] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [askApproval, setAskApproval] = useState(false);

  // Els gestos d'arrossegar es processen fora del cicle de Preact: necessiten l'estat més recent
  const latest = useRef({ pending, state, player, order, turnKey, me });
  latest.current = { pending, state, player, order, turnKey, me };
  const suppressClick = useRef(false);
  // «Juga» només val si el dit ha baixat sobre el botó després de l'últim canvi al tauler (D-41)
  const lastChange = useRef(0);
  const pressedAt = useRef<number | null>(null);

  /** Canvia les fitxes posades i les desa com a prova (sobreviuen a recarregar i al canvi de torn). */
  const setPending = (p: Pending[]) => {
    const { turnKey: key, state: st, player: pl, me: who } = latest.current;
    lastChange.current = performance.now();
    setHeld({ key, pending: p });
    saveDraft(st.gameId, who, p.map(x => ({ index: x.index, tile: pl.rack[x.slot]!, letter: x.letter })));
  };

  useEffect(() => {
    setSelected(null); setExchange(null); setOffer(null); setDrag(null);
    setOrder(arrangedOrder(state, me));
    const d = fromDraft(state, me);
    setPending(d.pending);
    if (d.dropped) setFlash(d.dropped === 1 ? "Una fitxa de la teva prova queia sobre una lletra nova: ha tornat a l'atril." : `${d.dropped} fitxes de la teva prova queien sobre lletres noves: han tornat a l'atril.`);
  }, [turnKey]);

  /** Canvia l'ordre de l'atril i el recorda per als torns següents. */
  const updateOrder = (o: number[]) => {
    setOrder(o);
    const { state: st, player: pl, me: who } = latest.current;
    saveArrangement(st.gameId, who, o.map(s => pl.rack[s]!));
  };

  const used = new Set(pending.map(p => p.slot));
  const placements: Placement[] = pending.map(p => ({ index: p.index, tile: player.rack[p.slot]!, letter: p.letter }));
  const check = pending.length ? checkPlay(view, placements, isWord) : null;

  // Fitxes en vermell: les de les paraules no vàlides, o totes si el problema és de posició
  const bad = new Set<number>();
  if (check && !check.ok) {
    const cells = check.error.code === "invalid-words" ? check.error.cells : pending.map(p => p.index);
    for (const c of cells) if (pending.some(p => p.index === c)) bad.add(c);
  }

  /** Desa una acció: la prova queda buida, perquè les fitxes ja s'han jugat (o canviat). */
  const commit = (n: GameState) => {
    setPending([]);
    onCommit(n);
  };

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
  const hitTest = (x0: number, y0: number, dragged: number | null) => {
    // El dit pot sortir una mica de la pantalla: es retalla a la zona visible
    const x = Math.min(Math.max(x0, 1), window.innerWidth - 2);
    const y = Math.min(Math.max(y0, GHOST_LIFT + 1), window.innerHeight - 2);
    const el = document.elementFromPoint(x, y - GHOST_LIFT);
    const cell = el?.closest<HTMLElement>("[data-i]");
    // L'atril es detecta on hi ha el dit (és a baix de tot) o on hi ha la fitxa
    const rack = document.elementFromPoint(x, y)?.closest<HTMLElement>(".rack") ?? el?.closest<HTMLElement>(".rack");
    let insert: number | null = null;
    if (rack && !cell) {
      // Posició on quedaria la fitxa: quantes fitxes de l'atril queden a l'esquerra del dit
      const centers = [...rack.querySelectorAll<HTMLElement>("[data-slot]")]
        .filter(b => Number(b.dataset.slot) !== dragged)
        .map(b => { const r = b.getBoundingClientRect(); return r.left + r.width / 2; });
      insert = centers.filter(c => c < x).length;
    }
    return { over: cell ? Number(cell.dataset.i) : null, overRack: !!rack && !cell, insert };
  };

  /** Posició de l'atril (slot) de la fitxa que s'arrossega. */
  const slotOf = (source: DragSource): number | null =>
    source.kind === "rack" ? source.slot : latest.current.pending.find(p => p.index === source.index)?.slot ?? null;

  const startDrag = (e: PointerEvent, source: DragSource) => {
    if (exchange || e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
      dragging = true;
      ev.preventDefault();
      setDrag({ source, x: ev.clientX, y: ev.clientY, ...hitTest(ev.clientX, ev.clientY, slotOf(source)) });
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) return; // era un toc: el gestiona onClick
      lastChange.current = performance.now();
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 350);
      setDrag(null);
      if (ev.type === "pointercancel") return;
      const slot = slotOf(source);
      const { over, overRack, insert } = hitTest(ev.clientX, ev.clientY, slot);
      const { pending: pend, state: st, order: ord } = latest.current;
      const free = over !== null && !st.board[over] && !pend.some(p => p.index === over);
      setFlash(null);
      if (overRack && insert !== null && slot !== null) updateOrder(moveTo(ord, slot, insert)); // reordena l'atril
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

  /**
   * Un clic a «Juga» que no ve d'un toc sobre el botó (clic fantasma després d'arrossegar, o el botó que es mou
   * sota el dit en canviar la pantalla) no juga. Amb el teclat (detail 0) sí que val.
   */
  const playClick = (e: MouseEvent) => {
    const at = pressedAt.current;
    pressedAt.current = null;
    if (e.detail !== 0 && (at === null || at < lastChange.current)) return;
    play();
  };

  const play = () => {
    const next = tryApply({ type: "play", placements });
    if (!next) return;
    if (senyorsAvailable(next, me)) setOffer(next);
    else commit(next);
  };

  const shuffleRack = () => {
    const o = [...order];
    for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j]!, o[i]!]; }
    updateOrder(o);
  };

  const status = flash
    ?? (exchange ? (state.bag.length < 7 ? errorText({ code: "bag-too-small" }) : "Toca les fitxes que vols canviar.")
    : !check ? (draftMode ? "Mentre esperes, pots ordenar l'atril i provar jugades: no compten fins que et toqui." : "Arrossega una fitxa al tauler, o toca la fitxa i després la casella.")
    : check.ok ? `${draftMode ? "Prova" : "Aquesta jugada"}: ${points(check.result.score)} · ${check.result.words.map(w => w.letters.map(l => TILE_LABELS[l]).join("")).join(", ")}${check.result.bingo ? " · scrabble +50!" : ""}`
    : `${draftMode ? "Prova: " : ""}${errorText(check.error)}`);

  const startOffer = !draftMode && senyorsAtTurnStart(state, me) && pending.length === 0 && !exchange;
  // Paraules que el diccionari no té, amb la posició correcta: es pot demanar que les aprovin (D-21)
  const unknownWords = check && !check.ok && check.error.code === "invalid-words" ? check.error.words : null;
  // Qui ha d'acceptar-la: el jugador següent (D-21)
  const approverName = state.players[nextPlayer(state)]!.name;
  const approveByNext = () => {
    const n = tryApply({ type: "propose", placements });
    setAskApproval(false);
    if (!n) return;
    const approver = proposalApprover(n);
    // Si el jugador següent és en aquest mòbil, ho accepta aquí mateix; si no, la proposta li arriba pel servidor o pel QR
    commit(n); // la proposta és una versió; l'acceptació, la següent
    if (approverHere && approver !== null) commit(applyAction(n, { type: "approve" }, isWord, approver));
  };
  const kind = (rack: number[]) => (rack.every(t => VOWELS.has(t)) ? "vocals" : "consonants");

  // Fitxa que s'està arrossegant (per dibuixar-la sota el dit)
  const ghost = drag && (() => {
    if (drag.source.kind === "rack") { const t = player.rack[drag.source.slot]!; return { tile: t, letter: t }; }
    const p = pending.find(q => q.index === (drag.source as { index: number }).index);
    return p ? { tile: player.rack[p.slot]!, letter: p.letter } : null;
  })();
  const dragSlot = drag?.source.kind === "rack" ? drag.source.slot : null;
  const dragCell = drag?.source.kind === "board" ? drag.source.index : null;
  // Mentre s'arrossega per sobre de l'atril, es veu com quedarà l'ordre
  const movingSlot = drag ? slotOf(drag.source) : null;
  const shownOrder = drag?.overRack && drag.insert !== null && movingSlot !== null ? moveTo(order, movingSlot, drag.insert) : order;

  return (
    <div class={`game${drag ? " dragging" : ""}`}>
      <Scorebar state={state} code={controlCode(state)} onMenu={onMenu} net={net} />
      {banners}
      {waitText && <p class="waiting" role="status">{waitText}</p>}
      <Board state={state} pending={pending.filter(p => p.index !== dragCell)} bad={bad} good={!!check?.ok}
        dropCell={drag?.over ?? null} zoom={zoom} onCell={onCell} me={me} draft={draftMode}
        proposed={state.proposal?.placements ?? []}
        onPendingDown={(e, i) => startDrag(e, { kind: "board", index: i })} />
      <div class={`status${check && !check.ok && !exchange ? " bad" : check?.ok ? " good" : ""}`} role="status">
        {status}
        {unknownWords && !draftMode && !exchange && !flash && <button class="ask" onClick={() => setAskApproval(true)}>Demana a {approverName} que l'accepti</button>}
      </div>

      {startOffer && (
        <div class="banner">
          <span>Tens senyors: set {kind(player.rack)}.</span>
          <button onClick={() => { const n = tryApply({ type: "senyors" }); if (n) commit(n); }}>Canvia les 7 fitxes</button>
        </div>
      )}

      <div class={`rack${drag?.overRack && dragCell !== null ? " drop" : ""}`} aria-label="El teu atril">
        {shownOrder.map(slot => {
          const t = player.rack[slot];
          if (t === undefined) return null;
          const cls = ["rtile", used.has(slot) || dragSlot === slot ? "used" : "", selected === slot ? "sel" : "", exchange?.has(slot) ? "sel" : "", t === BLANK ? "blank" : ""].join(" ");
          return (
            <button key={slot} data-slot={slot} class={cls} onClick={() => onSlot(slot)} aria-label={t === BLANK ? "escarràs" : TILE_LABELS[t]}
              onPointerDown={(e: PointerEvent) => {
                if (!used.has(slot)) { startDrag(e, { kind: "rack", slot }); return; }
                // Una fitxa ja posada al tauler: arrossegar-la des de l'atril la mou de lloc a l'atril
                const p = pending.find(q => q.slot === slot);
                if (p) startDrag(e, { kind: "board", index: p.index });
              }}>
              <TileFace tile={t} letter={t} />
            </button>
          );
        })}
      </div>

      {draftMode ? (
        <div class="actions">
          <button onClick={() => { setPending([]); setSelected(null); }} disabled={!pending.length}>Recull</button>
          <button onClick={shuffleRack}>Barreja</button>
          <button onClick={() => setZoom(!zoom)} aria-pressed={zoom}>{zoom ? "Redueix" : "Amplia"}</button>
          {waitActions}
        </div>
      ) : exchange ? (
        <div class="actions">
          <button class="primary" disabled={exchange.size === 0 || state.bag.length < 7}
            onClick={() => { const n = tryApply({ type: "exchange", tiles: [...exchange].map(s => player.rack[s]!) }); if (n) { if (senyorsAvailable(n, me)) setOffer(n); else commit(n); } }}>
            Canvia {exchange.size || ""}
          </button>
          <button onClick={() => setExchange(null)}>Cancel·la</button>
        </div>
      ) : (
        <div class="actions">
          <button class="primary" disabled={!check?.ok} onPointerDown={() => { pressedAt.current = performance.now(); }} onClick={playClick}>Juga</button>
          <button onClick={() => { setPending([]); setSelected(null); }} disabled={!pending.length}>Recull</button>
          <button onClick={shuffleRack}>Barreja</button>
          <button onClick={() => { setPending([]); setSelected(null); setExchange(new Set()); }} disabled={state.bag.length < 7}>Canvia</button>
          <button onClick={() => setConfirmPass(true)}>Passa</button>
          <button onClick={() => setZoom(!zoom)} aria-pressed={zoom}>{zoom ? "Redueix" : "Amplia"}</button>
        </div>
      )}

      {drag && ghost && drag.over !== null && (
        <Loupe state={state} pending={pending.filter(p => p.index !== dragCell)} rack={player.rack} target={drag.over}
          tile={ghost} x={drag.x} y={drag.y} draft={draftMode} />
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

      {askApproval && unknownWords && (approverHere ? (
        <Modal>
          <h2>{approverName}, acceptes {unknownWords.length === 1 ? "la paraula" : "les paraules"}?</h2>
          <p><strong>{unknownWords.join(", ")}</strong> no {unknownWords.length === 1 ? "és" : "són"} al diccionari. Si l'acceptes, la jugada val i la paraula servirà per a la resta de la partida.</p>
          <div class="row">
            <button class="primary" onClick={approveByNext}>Sí, l'accepto</button>
            <button onClick={() => setAskApproval(false)}>No</button>
          </div>
        </Modal>
      ) : (
        <Modal>
          <h2>Demanar a {approverName} que l'accepti?</h2>
          <p><strong>{unknownWords.join(", ")}</strong> no {unknownWords.length === 1 ? "és" : "són"} al diccionari. Li arribarà la jugada i, si l'accepta, valdrà i la paraula servirà per a la resta de la partida.</p>
          <div class="row">
            <button class="primary" onClick={approveByNext}>Envia-li</button>
            <button onClick={() => setAskApproval(false)}>Cancel·la</button>
          </div>
        </Modal>
      ))}

      {confirmPass && (
        <Modal>
          <h2>Vols passar el torn?</h2>
          <p>No jugaràs cap fitxa en aquest torn.</p>
          <div class="row">
            <button class="primary" onClick={() => { setConfirmPass(false); const n = tryApply({ type: "pass" }); if (n) commit(n); }}>Passa</button>
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
            <button class="primary" onClick={() => { const n = swapSenyors(offer, me); if (senyorsAvailable(n, me)) setOffer(n); else { setOffer(null); commit(n); } }}>Canvia-les</button>
            <button onClick={() => { const n = offer; setOffer(null); commit(n); }}>Me les quedo</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
