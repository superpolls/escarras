/** Pantalla de joc: tauler, atril, accions. Tot el que es fa aquí és «estat de pantalla» fins que es prem Juga. */
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

interface Pending { index: number; slot: number; letter: number }

export function TileFace({ tile, letter }: { tile: number; letter: number }) {
  const label = TILE_LABELS[letter] ?? "?";
  return (
    <>
      <span class={`l${label.length > 1 ? " long" : ""}`}>{label}</span>
      <span class="v">{tile === BLANK ? "" : TILE_VALUES[tile]}</span>
    </>
  );
}

function Board({ state, pending, onCell, zoom }: {
  state: GameState; pending: Pending[]; onCell: (i: number) => void; zoom: boolean;
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
          const cls = ["cell", prem ? `p-${prem}` : "", c ? "tile" : "", c?.tile === BLANK ? "blank" : "", p ? "tile pending" : "", last.has(i) ? "last" : ""].join(" ");
          return (
            <div key={i} data-i={i} class={cls} onClick={() => onCell(i)}>
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

  // Nou torn o nou atril: reinicia l'estat de pantalla
  useEffect(() => {
    setPending([]); setSelected(null); setExchange(null); setOffer(null);
    setOrder(state.players[state.current]!.rack.map((_, i) => i));
  }, [state.seq]);

  const used = new Set(pending.map(p => p.slot));
  const placements: Placement[] = pending.map(p => ({ index: p.index, tile: player.rack[p.slot]!, letter: p.letter }));
  const check = pending.length ? checkPlay(state, placements, isWord) : null;

  const tryApply = (action: Action): GameState | null => {
    try {
      return applyAction(state, action, isWord);
    } catch (e) {
      if (e instanceof EngineError) { setFlash(errorText(e.error)); vibrate(80); return null; }
      throw e;
    }
  };

  const onCell = (i: number) => {
    setFlash(null);
    if (exchange) return;
    const here = pending.find(p => p.index === i);
    if (here) { setPending(pending.filter(p => p !== here)); return; } // torna la fitxa a l'atril
    if (selected === null || state.board[i]) return;
    if (player.rack[selected] === BLANK) { setBlankCell({ index: i, slot: selected }); return; }
    setPending([...pending, { index: i, slot: selected, letter: player.rack[selected]! }]);
    setSelected(null);
  };

  const onSlot = (slot: number) => {
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
    : !check ? "Toca una fitxa del teu atril i després una casella."
    : check.ok ? `Aquesta jugada: ${points(check.result.score)} · ${check.result.words.map(w => w.letters.map(l => TILE_LABELS[l]).join("")).join(", ")}${check.result.bingo ? " · scrabble +50!" : ""}`
    : errorText(check.error));

  const startOffer = senyorsAtTurnStart(state, me) && pending.length === 0 && !exchange;

  return (
    <div class="game">
      <Scorebar state={state} code={controlCode(state)} onMenu={onMenu} />
      <Board state={state} pending={pending} onCell={onCell} zoom={zoom} />
      <div class={`status${check && !check.ok && !exchange ? " bad" : check?.ok ? " good" : ""}`} role="status">{status}</div>

      {startOffer && (
        <div class="banner">
          <span>Tens senyors: set {player.rack.every(t => VOWELS.has(t)) ? "vocals" : "consonants"}.</span>
          <button onClick={() => { const n = tryApply({ type: "senyors" }); if (n) onCommit(n); }}>Canvia les 7 fitxes</button>
        </div>
      )}

      <div class="rack" aria-label="El teu atril">
        {order.map(slot => {
          const t = player.rack[slot];
          if (t === undefined) return null;
          const cls = ["rtile", used.has(slot) ? "used" : "", selected === slot ? "sel" : "", exchange?.has(slot) ? "sel" : "", t === BLANK ? "blank" : ""].join(" ");
          return <button key={slot} class={cls} onClick={() => onSlot(slot)} aria-label={t === BLANK ? "escarràs" : TILE_LABELS[t]}><TileFace tile={t} letter={t} /></button>;
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
          <p>Has robat set {offer.players[me]!.rack.every(t => VOWELS.has(t)) ? "vocals" : "consonants"}. Pots canviar les 7 fitxes sense perdre el torn.</p>
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
