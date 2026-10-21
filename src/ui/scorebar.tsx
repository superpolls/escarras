import type { GameState } from "../core/types";

/** Marcador: de qui és el torn, punts, fitxes a la bossa i codi de control. */
export function Scorebar({ state, code, onMenu, net }: { state: GameState; code: string; onMenu?: () => void; net?: string }) {
  return (
    <header class="scorebar">
      <ol class="players">
        {state.order.map(i => {
          const p = state.players[i]!;
          return (
            <li key={i} class={i === state.current && !state.ended ? "now" : ""}>
              <span class="name">{p.name}</span>
              <span class="pts">{p.score}</span>
            </li>
          );
        })}
      </ol>
      <div class="meta">
        <span>Bossa: {state.bag.length}</span>
        <span title="Codi de control: ha de ser igual a tots els mòbils">Codi {code}</span>
        {onMenu && <button class="menu" onClick={onMenu} aria-label="Menú">Menú</button>}
      </div>
      {net && <div class={`net${net.startsWith("Sincronitzat") ? " ok" : ""}`} role="status">{net}</div>}
    </header>
  );
}
