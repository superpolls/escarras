/**
 * «Juga» no s'activa amb un clic que no ve d'un toc sobre el botó (D-41).
 *   npx tsx tests/fake-rtdb.ts 9400 &  ;  npx vite preview --port 4173 &  ;  npx tsx e2e/ghost.ts
 * Posa una paraula vàlida i envia a «Juga» un clic sense «pointerdown» (com un clic fantasma de l'iPhone):
 * la jugada no s'ha de fer. Després, un toc de debò sí que la fa.
 */
import { firstMove, keepSenyors, launch, phone, place, state, URL } from "./lib";

const errors: string[] = [];
const browser = await launch();
const { page } = await phone(browser, errors);

await page.goto(URL);
await page.getByRole("button", { name: "Nova partida" }).click();
await page.getByRole("button", { name: "Comença" }).click();
await page.getByRole("button", { name: "Tots amb aquest mòbil" }).click();
await page.getByRole("button", { name: "Som-hi" }).click();
await page.getByRole("button", { name: /^Sóc / }).click();

const s = await state(page);
const move = firstMove(s);
if (!move) throw new Error("No he trobat cap primera jugada (atril sense paraula): torna-ho a provar");
await place(page, move);
const juga = page.getByRole("button", { name: "Juga" });
await juga.waitFor();
if (await juga.isDisabled()) throw new Error("La paraula hauria de ser vàlida");

// Clic fantasma: només «click», amb detail 1, sense «pointerdown» abans
await juga.evaluate(b => b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
await page.waitForTimeout(300);
const afterGhost = (await state(page)).seq;
console.log("Després del clic fantasma, versió:", afterGhost, "(ha de ser", s.seq + ")");
if (afterGhost !== s.seq) throw new Error("El clic fantasma ha jugat");

await juga.click();
await keepSenyors(page);
await page.waitForTimeout(300);
const afterTap = (await state(page)).seq;
console.log("Després del toc, versió:", afterTap);
if (afterTap !== s.seq + 1) throw new Error("El toc de debò no ha jugat");
console.log(errors.length ? errors : "Cap error.");
await browser.close();
