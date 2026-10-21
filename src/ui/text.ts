/** Tots els textos de l'app, en català i en un sol lloc (encàrrec, secció 7). */
import type { MoveError } from "../core/game";
import type { GameState, LastAction } from "../core/types";
import type { NetStatus } from "../sync/session";

export function errorText(e: MoveError): string {
  switch (e.code) {
    case "game-over": return "La partida ja s'ha acabat.";
    case "not-your-turn": return "No és el teu torn.";
    case "not-active": return "Aquest jugador ja no és a la partida.";
    case "no-tiles": return "Posa alguna fitxa al tauler.";
    case "off-board": return "Aquesta casella és fora del tauler.";
    case "duplicate":
    case "occupied": return "Aquesta casella ja està ocupada.";
    case "not-in-rack": return "Aquesta fitxa no és al teu atril.";
    case "bad-blank": return "Tria quina lletra fa l'escarràs.";
    case "not-aligned": return "Les fitxes han d'anar en una sola fila o columna.";
    case "gap": return "No hi pot quedar cap forat entre les fitxes.";
    case "first-center": return "La primera paraula ha de passar per l'estrella del centre.";
    case "first-two": return "La primera paraula ha de tenir almenys dues fitxes.";
    case "not-connected": return "La paraula ha de tocar alguna fitxa del tauler.";
    case "invalid-words":
      return e.words.length === 1
        ? `«${e.words[0]}» no és vàlida.`
        : `${e.words.slice(0, -1).map(w => `«${w}»`).join(", ")} i «${e.words.at(-1)}» no són vàlides.`;
    case "bag-too-small": return "Per canviar fitxes cal que en quedin almenys 7 a la bossa.";
    case "bad-exchange": return "Tria entre 1 i 7 fitxes per canviar.";
    case "table-full": return "Ja hi ha 4 jugadors.";
    case "vote-in-progress": return "Ja hi ha una votació en curs.";
    case "proposal-pending": return "Hi ha una jugada pendent d'aprovació.";
    case "not-allowed": return "Ara no es pot fer.";
  }
}

export const points = (n: number) => (n === 1 ? "1 punt" : `${n} punts`);

/** Text breu d'una acció, per als avisos i el resum del torn («Anna ha passat»). */
export function describeAction(s: GameState, last: LastAction): string {
  const who = s.players[last.player]?.name ?? "Algú";
  const a = last.action;
  switch (a.type) {
    case "play": return `${who} ha jugat ${a.placements.length} ${a.placements.length === 1 ? "fitxa" : "fitxes"}`;
    case "exchange": return `${who} ha canviat ${a.tiles.length} ${a.tiles.length === 1 ? "fitxa" : "fitxes"}`;
    case "pass": return `${who} ha passat`;
    case "undo": return `${who} ha desfet la seva jugada`;
    case "senyors": return `${who} ha canviat els senyors`;
    case "leave": return `${who} ha abandonat la partida`;
    case "vote-remove": return `${who} ha votat per treure ${s.players[a.target]?.name ?? "un jugador"}`;
    case "join": return `${who} ha fet entrar ${a.name}`;
    case "rejoin": return `${who} ha fet tornar ${s.players[a.player]?.name ?? "un jugador"}`;
    case "propose": return `${who} demana que s'accepti una paraula`;
    case "approve": return `${who} ha acceptat la paraula`;
    case "reject": return `${who} no ha acceptat la paraula`;
  }
}

export function netText(n: NetStatus, pending: boolean): string {
  switch (n) {
    case "none": return "Sense servidor: fes servir el QR";
    case "connecting": return "Connectant…";
    case "synced": return pending ? "Pendent de pujar" : "Sincronitzat ✓";
    case "pending": return "Pendent de pujar";
    case "offline": return "Sense connexió: fes servir el QR";
  }
}
