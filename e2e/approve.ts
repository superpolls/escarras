/** Prova: una paraula que el diccionari no té es pot fer aprovar (mode d'un sol mòbil). */
import { chromium } from "playwright";
import { lex, OUT, state } from "./lib";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
const errors: string[] = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto("http://localhost:4173/escarras/app/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole("button", { name: "Nova partida" }).click();
await page.getByRole("button", { name: "Comença" }).click();
await page.getByRole("button", { name: "Tots amb aquest mòbil" }).click();
await page.getByRole("button", { name: "Som-hi" }).click();
await page.getByRole("button", { name: /^Sóc / }).click();
const s = await state(page);
const rack = s.players[s.current]!.rack;
// Dues fitxes (sense escarràs) que no formin cap paraula del diccionari
let pair: [number, number] | null = null;
for (let a = 0; a < 7 && !pair; a++) for (let b = 0; b < 7 && !pair; b++)
  if (a !== b && rack[a] && rack[b] && !lex.has([rack[a]!, rack[b]!])) pair = [a, b];
if (!pair) throw new Error("No hi ha cap parella no vàlida");
for (const [k, slot] of pair.entries()) {
  await page.locator(`.rack button[data-slot="${slot}"]`).click();
  await page.locator(`[data-i="${112 + k}"]`).click();
}
console.log("Estat:", await page.locator(".status").innerText());
await page.screenshot({ path: `${OUT}/12-demana-aprovacio.png` });
await page.getByRole("button", { name: /^Demana a .+ que l'accepti$/ }).click();
await page.screenshot({ path: `${OUT}/13-accepteu.png` });
console.log("Pregunta:", await page.locator(".modal h2").innerText());
await page.getByRole("button", { name: "Sí, l'accepto" }).click();
console.log("Traspàs:", await page.locator(".last-move").innerText());
const after = await state(page);
console.log("Paraules aprovades:", after.approvedWords.length, "· fitxes al tauler:", after.board.filter(Boolean).length);
await browser.close();
console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "Cap error.");
process.exit(errors.length ? 1 : 0);
