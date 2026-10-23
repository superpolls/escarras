/**
 * Dos jugadors en un mòbil i el tercer en un altre (D-42).
 *   npx tsx tests/fake-rtdb.ts 9400 &  ;  npx vite preview --port 4173 &  ;  npx tsx e2e/peek.ts
 * Quan li toca al jugador de l'altre mòbil, el primer mòbil no mostra cap atril, però cadascun dels seus jugadors
 * pot obrir les seves fitxes («Fitxes de …»), provar una jugada i amagar-les. Una jugada nova les torna a amagar.
 */
import type { Page } from "playwright";
import { launch, phone, seats, state, URL, waitUntil } from "./lib";

const errors: string[] = [];
const browser = await launch();
const A = await phone(browser, errors, "[A]");
const B = await phone(browser, errors, "[B]");
const log = (...a: unknown[]) => console.log(...a);

await A.page.goto(URL);
await A.page.getByRole("button", { name: "Nova partida" }).click();
await A.page.getByRole("button", { name: "3", exact: true }).click();
await A.page.getByRole("button", { name: "Comença" }).click();
await A.page.getByRole("button", { name: "Cadascú amb el seu mòbil" }).click();
await A.page.getByRole("button", { name: "Amb aquest mòbil" }).first().click(); // el Jugador 2 també aquí
await A.page.getByText("Sincronitzat ✓").waitFor();
const link = (await A.page.locator("[data-link]").getAttribute("data-link"))!;
await B.page.goto(link);
await B.page.getByRole("heading", { name: /^Ets / }).waitFor();
await B.page.getByRole("button", { name: "Som-hi" }).click();
await A.page.getByRole("button", { name: "Som-hi" }).click(); // al sorteig
await A.page.getByRole("button", { name: "Som-hi" }).click();
const mine = await seats(A.page);
log("Mòbil A porta:", mine, "· mòbil B:", await seats(B.page));

/** Passa el torn des del mòbil que el té (amb el traspàs «Sóc …» si n'hi ha). */
async function pass(p: Page) {
  const soc = p.getByRole("button", { name: /^Sóc / });
  if (await soc.isVisible().catch(() => false)) await soc.click();
  await p.getByRole("button", { name: "Passa" }).click();
  await p.locator(".modal").getByRole("button", { name: "Passa" }).click();
}

// Fins que li toqui al jugador del mòbil B
for (let k = 0; k < 3; k++) {
  const s = await state(A.page);
  if (!mine.includes(s.current)) break;
  await pass(A.page);
  await waitUntil(async () => (await state(B.page)).seq === s.seq + 1, 8000, "la passada arriba a B");
}
const s = await state(A.page);
if (mine.includes(s.current)) throw new Error("No li toca a B");

const peekBtns = A.page.getByRole("button", { name: /^Fitxes de / });
await peekBtns.first().waitFor({ timeout: 8000 });
log("Botons per mirar fitxes:", await peekBtns.allInnerTexts(), "· atrils visibles abans:", await A.page.locator(".rack").count());
await peekBtns.first().click();
await A.page.locator(".rack button[data-slot]").first().waitFor();
const rackSize = await A.page.locator(".rack button[data-slot]").count();
await A.page.locator('.rack button[data-slot="0"]').click();
await A.page.locator('[data-i="112"]').click();
log("Atril obert:", rackSize, "fitxes · prova:", await A.page.locator(".cell.pending.draft").count(), "·", await A.page.locator(".status").innerText());
await A.page.screenshot({ path: `${process.env.SHOTS ?? "e2e/shots"}/peek.png` });
await A.page.getByRole("button", { name: "Amaga les fitxes" }).click();
log("Després d'amagar, atrils visibles:", await A.page.locator(".rack").count());

// Una jugada nova (B passa) també les amaga
await peekBtns.first().click();
await A.page.locator(".rack button[data-slot]").first().waitFor();
await pass(B.page);
await waitUntil(async () => (await state(A.page)).seq === s.seq + 1, 8000, "la passada de B arriba a A");
await A.page.waitForTimeout(300);
log("Després de la jugada de B, a A es veu:", await A.page.getByRole("button", { name: /^Sóc / }).isVisible() ? "«Sóc …» (traspàs)" : `${await A.page.locator(".rack").count()} atrils`);
console.log(errors.length ? errors : "Cap error.");
await browser.close();
