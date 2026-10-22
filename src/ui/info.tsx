/**
 * Avís beta, instal·lació i informació (D-33, D-34).
 * - Benvinguda: només el primer cop que s'obre l'app en aquest navegador (o en l'app instal·lada).
 * - Informació: l'avís complet, la privacitat, la llicència i la versió.
 */
import { OFFICIAL_URL } from "../server";
import { BUILD_DATE, VERSION } from "./config";

const SEEN_KEY = "escarras-avis-v1";

export function welcomeSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; }
}

export function markWelcomeSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* res */ }
}

type Platform = "ios" | "android" | "other";

function platform(): Platform {
  const ua = navigator.userAgent;
  // L'iPad es presenta com a Mac, però amb pantalla tàctil
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** Oberta des de la icona de la pantalla d'inici (app instal·lada). */
export function isInstalled(): boolean {
  try {
    return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Com instal·lar-la en aquest mòbil i per què. No es mostra si ja està instal·lada. */
export function InstallHelp() {
  if (isInstalled()) return null;
  const p = platform();
  return (
    <section class="install">
      <h2>Instal·la-la al mòbil</h2>
      {p === "ios" && (
        <ol>
          <li>Obre-la a Safari (si ve de WhatsApp, primer obre-la al navegador).</li>
          <li>Toca <strong>Compartir</strong> (o <strong>···</strong>) i tria <strong>«Afegeix a la pantalla d'inici»</strong>.</li>
        </ol>
      )}
      {p === "android" && (
        <ol>
          <li>A Chrome, toca el menú <strong>⋮</strong>.</li>
          <li>Tria <strong>«Instal·la l'aplicació»</strong> o <strong>«Afegeix a la pantalla d'inici»</strong>.</li>
        </ol>
      )}
      {p === "other" && <p>Obre aquest enllaç al mòbil i afegeix-lo a la pantalla d'inici des del menú del navegador.</p>}
      <p class="sub">
        {p === "android"
          ? "Així el navegador no esborrarà una partida a mitges quan li falti espai."
          : "Així el navegador no esborrarà una partida a mitges si passes 7 dies sense obrir-la."}
        {p === "ios" && " Fes-ho abans de començar: a l'iPhone, la icona i Safari no comparteixen partides."}
      </p>
    </section>
  );
}

/** Primer arranc: avís curt i instal·lació. */
export function Welcome({ onOk }: { onOk: () => void }) {
  return (
    <main class="page welcome">
      <h1>Escarràs <span class="beta">beta</span></h1>
      <p>Joc gratuït i sense garanties: el fas servir sota la teva responsabilitat. <strong>Mai et demanarà contrasenyes, dades ni pagaments.</strong></p>
      <InstallHelp />
      <button class="primary big" onClick={onOk}>Ho entenc</button>
      <p class="sub small">L'avís complet és a «Informació».</p>
    </main>
  );
}

/** Pantalla d'informació: avís complet, privacitat, crèdits i versió. */
export function Info({ onBack }: { onBack: () => void }) {
  return (
    <main class="page info">
      <h1>Informació</h1>

      <h2>Versió beta: ús sota la teva responsabilitat</h2>
      <p>Escarràs és una aplicació en fase beta, gratuïta, de codi obert i sense ànim de lucre, feta per jugar en família i amb amics. S'ofereix «tal com és», sense cap garantia de funcionament, disponibilitat ni idoneïtat per a cap ús. La fas servir sota la teva responsabilitat. En la mesura que ho permeti la llei, l'autor no es fa responsable de cap dany o pèrdua derivats del seu ús, inclosa la pèrdua de partides.</p>
      <p>L'única versió oficial és la publicada a <strong>{OFFICIAL_URL}</strong>. Les còpies modificades per tercers no són responsabilitat de l'autor.</p>
      <p><strong>Escarràs mai et demanarà contrasenyes, dades bancàries, pagaments ni dades personals.</strong> Si mai veus una petició així, tanca l'app i avisa qui t'ha passat l'enllaç.</p>

      <h2>Privacitat</h2>
      <p>No hi ha publicitat ni analítica. A les partides en línia, els noms i el tauler viatgen xifrats amb la clau de l'enllaç; el servidor (Google Firebase) només veu dades xifrades, l'adreça IP i l'hora. Qui tingui l'enllaç pot entrar a la partida: comparteix-lo només amb els jugadors.</p>

      <InstallHelp />

      <h2>Crèdits i llicència</h2>
      <p>Diccionari: <strong>DISC 2.18.25</strong> (Diccionari Informatitzat de l'Scrabble en Català), de Joan Montané, amb llicència GPLv3 / CC-BY-SA 3.0. <a href="https://diccionari.totescrable.cat/" target="_blank" rel="noopener noreferrer">diccionari.totescrable.cat</a></p>
      <p>Paraules no oficials (opcional en crear la partida): diccionari de <strong>Softcatalà</strong> (catalan-dict-tools), amb llicència LGPL-2.1. <a href="https://github.com/Softcatala/catalan-dict-tools" target="_blank" rel="noopener noreferrer">github.com/Softcatala/catalan-dict-tools</a></p>
      <p>Reglament: AJUSC i FISC. Codi amb llicència GPL-3.0: <a href="https://github.com/superpolls/escarras" target="_blank" rel="noopener noreferrer">github.com/superpolls/escarras</a></p>
      <p class="sub">Versió {VERSION}{BUILD_DATE && ` · ${BUILD_DATE}`}</p>

      <button onClick={onBack}>Torna</button>
    </main>
  );
}
