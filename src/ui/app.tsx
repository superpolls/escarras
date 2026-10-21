/** Aplicació: pantalles i flux de la partida en un sol mòbil (M3). */
import { useEffect, useState } from "preact/hooks";
import { checkPlay, createGame, MAX_NAME_CHARS, standings, undoState, canUndo, type IsWord } from "../core/game";
import { TILE_LABELS } from "../core/tiles";
import type { GameState, Placement } from "../core/types";
import { GameScreen, TileFace } from "./game-screen";
import { askPersistence, clearGame, loadGame, saveGame, type Saved } from "./storage";
import { loadLexicon, newGameId, randomBytes, vibrate } from "./support";
import { points } from "./text";

type Screen = "home" | "setup" | "draw" | "handoff" | "play" | "end" | "credits";

const defaultNames = (n: number) => Array.from({ length: n }, (_, i) => `Jugador ${i + 1}`);

export function App() {
  const [isWord, setIsWord] = useState<IsWord | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(() => loadGame());
  const [screen, setScreen] = useState<Screen>("home");
  const [menu, setMenu] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);

  const load = () => {
    setLoadError(false);
    loadLexicon().then(lex => setIsWord(() => (t: readonly number[]) => lex.has(t))).catch(() => setLoadError(true));
  };
  useEffect(() => { load(); void askPersistence(); }, []);

  const store = (s: Saved) => { setSaved(s); saveGame(s); };

  const start = (names: string[]) => {
    const state = createGame({ gameId: newGameId(), seed: randomBytes(16), names });
    store({ state, prev: null });
    setScreen("draw");
  };

  const commit = (next: GameState) => {
    const prev = saved!.state;
    store({ state: next, prev });
    if (next.ended) setScreen("end");
    else if (next.current !== prev.current) { vibrate(); setScreen("handoff"); }
  };

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

  const state = saved?.state;

  if (screen === "credits") {
    return (
      <main class="page">
        <h1>Crèdits</h1>
        <p>Diccionari: <strong>DISC 2.18.25</strong> (Diccionari Informatitzat de l'Scrabble en Català), de Joan Montané, amb llicència GPLv3 / CC-BY-SA 3.0. <a href="https://diccionari.totescrable.cat/" target="_blank" rel="noopener">diccionari.totescrable.cat</a></p>
        <p>Reglament: AJUSC i FISC. Escarràs és un joc familiar sense ànim de lucre.</p>
        <button onClick={() => setScreen("home")}>Torna</button>
      </main>
    );
  }

  if (screen === "setup") return <Setup onStart={start} onBack={() => setScreen("home")} />;

  if (!state || screen === "home") {
    return (
      <main class="page home">
        <h1>Escarràs</h1>
        <p class="sub">Paraules encreuades en català</p>
        {state && !state.ended && <button class="primary big" onClick={() => setScreen("handoff")}>Continua la partida</button>}
        {state?.ended && <button class="big" onClick={() => setScreen("end")}>Resultat de l'última partida</button>}
        <button class={state && !state.ended ? "big" : "primary big"} onClick={() => (state && !state.ended ? setConfirmNew(true) : setScreen("setup"))}>Nova partida</button>
        <button class="link" onClick={() => setScreen("credits")}>Crèdits</button>
        {confirmNew && (
          <div class="modal-back"><div class="modal">
            <h2>Començar una partida nova?</h2>
            <p>La partida en curs es perdrà.</p>
            <div class="row">
              <button class="primary" onClick={() => { setConfirmNew(false); clearGame(); setSaved(null); setScreen("setup"); }}>Sí, nova partida</button>
              <button onClick={() => setConfirmNew(false)}>Cancel·la</button>
            </div>
          </div></div>
        )}
      </main>
    );
  }

  if (screen === "draw") return <Draw state={state} onGo={() => setScreen("handoff")} />;

  if (screen === "end" || state.ended) {
    return <End state={state} onAgain={() => start(state.players.filter(p => p.status !== "retired").map(p => p.name).slice(0, 4))} onHome={() => { clearGame(); setSaved(null); setScreen("home"); }} />;
  }

  if (screen === "handoff") {
    const prev = saved!.prev;
    const lastPlayer = state.last?.player;
    const undoable = prev && lastPlayer !== undefined && canUndo(state, lastPlayer);
    return (
      <main class="page handoff">
        {state.last && <LastMove state={state} prev={prev} />}
        <h1>Passa el mòbil a<br /><span class="who">{state.players[state.current]!.name}</span></h1>
        <button class="primary big" onClick={() => setScreen("play")}>Sóc {state.players[state.current]!.name}</button>
        {undoable && (
          <button class="link" onClick={() => {
            const undone = undoState(state, prev!);
            store({ state: undone, prev: null });
            setScreen("play");
          }}>{state.players[lastPlayer]!.name}: m'he equivocat, desfés la jugada</button>
        )}
      </main>
    );
  }

  return (
    <>
      <GameScreen state={state} isWord={isWord} onCommit={commit} onMenu={() => setMenu(true)} />
      {menu && (
        <div class="modal-back"><div class="modal">
          <h2>Menú</h2>
          <div class="col">
            <button onClick={() => { setMenu(false); setScreen("home"); }}>Torna a l'inici (la partida queda desada)</button>
            <button onClick={() => { setMenu(false); setConfirmNew(true); setScreen("home"); }}>Abandona aquesta partida</button>
            <button class="primary" onClick={() => setMenu(false)}>Continua jugant</button>
          </div>
        </div></div>
      )}
    </>
  );
}

function Setup({ onStart, onBack }: { onStart: (names: string[]) => void; onBack: () => void }) {
  const [n, setN] = useState(2);
  const [names, setNames] = useState(defaultNames(4));
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

function LastMove({ state, prev }: { state: GameState; prev: GameState | null }) {
  const last = state.last!;
  const who = state.players[last.player]!.name;
  const a = last.action;
  let text: string;
  const wordsOf = (placements: Placement[]) => {
    if (!prev) return "";
    const c = checkPlay(prev, placements, () => true);
    return c.ok ? c.result.words.map(w => w.letters.map(l => TILE_LABELS[l]).join("")).join(", ") : "";
  };
  if (a.type === "play") {
    text = `${who} ha jugat ${wordsOf(a.placements)} · ${points(last.score)}`;
  } else if (a.type === "approve" && prev) {
    // Les fitxes noves són les que hi ha ara i abans no hi eren
    const placed = state.board.flatMap((c, index) => (c && !prev.board[index] ? [{ index, tile: c.tile, letter: c.letter }] : []));
    const mover = state.players[prev.current]!.name;
    text = `${mover} ha jugat ${wordsOf(placed)} (l'ha acceptada ${who}) · ${points(last.score)}`;
  } else if (a.type === "exchange") text = `${who} ha canviat ${a.tiles.length} ${a.tiles.length === 1 ? "fitxa" : "fitxes"}`;
  else if (a.type === "pass") text = `${who} ha passat`;
  else if (a.type === "undo") text = `${who} ha desfet la jugada`;
  else text = "";
  if (last.senyorsSwaps) text += " i ha canviat senyors";
  return text ? <p class="last-move">{text}</p> : null;
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
