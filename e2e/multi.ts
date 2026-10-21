/**
 * Prova amb tres mòbils simulats (M4 + M4b), contra el servidor fals de Firebase:
 *   npx tsx tests/fake-rtdb.ts 9400 &  ;  VITE_RTDB_URL=http://127.0.0.1:9400 npm run build  ;  npx vite preview --port 4173 &
 *   npx tsx e2e/multi.ts
 * 1. L'Anna crea la partida i convida amb l'enllaç; el Biel l'obre i és el Jugador 2 automàticament.
 * 2. Juguen en línia: cada jugada arriba sola a l'altre mòbil. Una paraula fora del diccionari l'accepta l'altre.
 * 3. Sense connexió: juguen passant-se el QR. En tornar la connexió, tot es puja i coincideix.
 * 4. Un mòbil nou recupera el Biel: l'Anna ho confirma i el mòbil antic deixa de portar-lo.
 */
import type { Page } from "playwright";
import { stateHash } from "../src/core/codec";
import { checkPlay } from "../src/core/game";
import type { GameState } from "../src/core/types";
import { denied, firstMove, isWord, keepSenyors, launch, OUT, phone, place, seats, state, URL, waitUntil } from "./lib";

const errors: string[] = [];
const browser = await launch();
const A = await phone(browser, errors, "[Anna]");
const B = await phone(browser, errors, "[Biel]");
const log = (...a: unknown[]) => console.log(...a);

const turnOf = async (s: GameState) => ((await seats(A.page)).includes(s.current) ? A.page : B.page);
const other = (p: Page) => (p === A.page ? B.page : A.page);
const sameState = async () => stateHash(await state(A.page)) === stateHash(await state(B.page));
const myTurnVisible = (p: Page) => p.getByRole("button", { name: "Juga" }).isVisible().catch(() => false);

// 1. Crear i convidar
await A.page.goto(URL);
await A.page.getByRole("button", { name: "Nova partida" }).click();
await A.page.getByLabel("Nom del jugador 1").fill("Anna");
await A.page.getByLabel("Nom del jugador 2").fill("Biel");
await A.page.getByRole("button", { name: "Comença" }).click();
await A.page.getByRole("button", { name: "Cadascú amb el seu mòbil" }).click();
await A.page.getByText("Sincronitzat ✓").waitFor();
const link = (await A.page.locator("[data-link]").getAttribute("data-link"))!;
log("Enllaç d'invitació:", link.replace(/#j=.*/, "#j=…"));
await B.page.goto(link);
await B.page.getByRole("heading", { name: "Ets Biel" }).waitFor();
await B.page.screenshot({ path: `${OUT}/m1-ets-biel.png` });
await B.page.getByLabel("El teu nom").fill("Biel M.");
await B.page.getByRole("button", { name: "Som-hi" }).click();
await A.page.getByText("té mòbil ✓").waitFor();
await A.page.screenshot({ path: `${OUT}/m2-convida.png` });
await A.page.getByRole("button", { name: "Som-hi" }).click(); // al sorteig
await A.page.getByRole("button", { name: "Som-hi" }).click();

// 2. En línia
let s = await state(A.page);
let p = await turnOf(s);
await waitUntil(() => myTurnVisible(p), 8000, "torn del primer jugador");
const move = firstMove(await state(p))!;

// Mentre espera, l'altre prepara una prova: una fitxa on jugarà el primer i una altra lluny
const waiter = other(p);
const ws = await state(waiter);
const wSeat = (await seats(waiter))[0]!;
const free = ws.players[wSeat]!.rack.map((t, i) => (t === 0 ? -1 : i)).filter(i => i >= 0);
await place(waiter, { slots: [free[0]!, free[1]!], cells: [move.cells[0]!, 0] });
const drafts = await waiter.locator(".cell.pending.draft").count();
log("Prova mentre espera:", drafts, "fitxes lila ·", await waiter.locator(".status").innerText());
await waiter.screenshot({ path: `${OUT}/m0-prova.png` });
if (drafts !== 2) throw new Error("La prova no es veu al tauler");

await place(p, move);
await p.getByRole("button", { name: "Juga" }).click();
await keepSenyors(p);
await waitUntil(sameState, 8000, "la primera jugada arriba a l'altre mòbil");
log("Jugada 1 rebuda sense QR. Estat:", await other(p).locator(".net").innerText());
await waitUntil(() => myTurnVisible(waiter), 8000, "torn de qui esperava");
const kept = await waiter.locator(".cell.pending").evaluateAll(cs => cs.map(c => Number(c.getAttribute("data-i"))));
log("En arribar el torn, queden a la prova les caselles:", kept.join(","), "·", await waiter.locator(".status").innerText());
await waiter.screenshot({ path: `${OUT}/m0-prova-torn.png` });
if (kept.length !== 1 || kept[0] !== 0) throw new Error("Només havia de tornar a l'atril la fitxa trepitjada");
await waiter.getByRole("button", { name: "Recull" }).click();

// Paraula fora del diccionari: una fitxa sota la primera lletra; l'accepta l'altre mòbil
s = await state(A.page);
p = await turnOf(s);
await waitUntil(() => myTurnVisible(p), 8000, "torn del segon jugador");
s = await state(p);
const rack = s.players[s.current]!.rack;
const start = s.board.findIndex(c => c);
let tried = false;
for (let slot = 0; slot < rack.length && !tried; slot++) {
  const t = rack[slot]!;
  if (t === 0) continue;
  const c = checkPlay(s, [{ index: start + 15, tile: t, letter: t }], isWord);
  if (!c.ok && c.error.code === "invalid-words") {
    await place(p, { slots: [slot], cells: [start + 15] });
    tried = true;
  }
}
if (!tried) throw new Error("No he trobat cap paraula no vàlida per provar l'aprovació");
await p.getByRole("button", { name: /^Demana a .+ que l'accepti$/ }).click();
await p.getByRole("button", { name: "Envia-li" }).click();
const q = other(p);
await q.getByRole("button", { name: "Sí, l'accepto" }).waitFor({ timeout: 8000 });
await q.screenshot({ path: `${OUT}/m3-accepta.png` });
await p.screenshot({ path: `${OUT}/m3-espera.png` });
await q.getByRole("button", { name: "Sí, l'accepto" }).click();
await waitUntil(sameState, 8000, "l'aprovació arriba als dos mòbils");
s = await state(A.page);
log("Paraules aprovades:", s.approvedWords.length, "· nom canviat:", s.players.map(x => x.name).join(", "));

// Amb connexió, qui espera no veu cap botó de QR (la jugada arriba sola)
const waitingPage = other(await turnOf(await state(A.page)));
log("Botons de QR amb connexió:", await waitingPage.getByRole("button", { name: /QR/ }).count());

// 3. Sense connexió: QR
await A.ctx.setOffline(true);
await B.ctx.setOffline(true);
for (let k = 0; k < 2; k++) {
  s = await state(A.page);
  p = await turnOf(s);
  await waitUntil(() => myTurnVisible(p), 8000, "torn sense connexió");
  await p.getByRole("button", { name: "Passa" }).click();
  await p.locator(".modal").getByRole("button", { name: "Passa" }).click();
  const qr = p.locator("canvas.qr");
  await qr.waitFor({ timeout: 8000 });
  if (k === 0) await p.screenshot({ path: `${OUT}/m4-qr.png` });
  const code = (await qr.getAttribute("data-code"))!;
  await p.getByRole("button", { name: "Fet" }).click();
  const r = other(p);
  await r.getByRole("button", { name: /escaneja el QR quan et toqui/ }).click();
  await r.getByLabel("Enllaç o codi").fill(code);
  await r.getByRole("button", { name: "D'acord" }).click();
  await waitUntil(sameState, 5000, "el QR passa la jugada");
}
log("Dues passades amb QR. Estat sense connexió:", await A.page.locator(".net").innerText());
await A.ctx.setOffline(false);
await B.ctx.setOffline(false);
await waitUntil(async () => (await A.page.locator(".net").innerText()).includes("Sincronitzat") && (await B.page.locator(".net").innerText()).includes("Sincronitzat"), 25000, "tornar a sincronitzar");
log("En tornar la connexió:", await A.page.locator(".net").innerText(), "· mateix estat:", await sameState());

// 4. Recuperar el Biel des d'un mòbil nou
const C = await phone(browser, errors, "[nou]");
await C.page.goto(link);
await C.page.getByRole("heading", { name: "Qui ets?" }).waitFor();
await C.page.getByRole("button", { name: "Biel M." }).click();
await C.page.getByText(/Esperant que un altre jugador confirmi/).waitFor();
await A.page.getByRole("button", { name: /^Sí, és / }).waitFor({ timeout: 10000 });
await A.page.screenshot({ path: `${OUT}/m5-confirma.png` });
await A.page.getByRole("button", { name: /^Sí, és / }).click();
await C.page.getByRole("heading", { name: /^Ets / }).waitFor({ timeout: 10000 });
await C.page.getByRole("button", { name: "Som-hi" }).click();
await waitUntil(async () => (await seats(B.page)).length === 0, 10000, "el mòbil antic deixa el Biel");
log("Recuperat: el mòbil nou porta", await seats(C.page), "· l'antic", await seats(B.page));
await C.page.screenshot({ path: `${OUT}/m6-nou.png` });

await browser.close();
log(errors.length ? `ERRORS: ${errors.join(" | ")}` : `Cap error a la consola (escriptures rebutjades pel candau: ${denied.count}).`);
process.exit(errors.length ? 1 : 0);
