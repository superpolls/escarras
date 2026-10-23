/**
 * L'app s'obre sense connexió (D-44).
 *   npx tsx tests/fake-rtdb.ts 9400 &  ;  npx vite preview --port 4173 &  ;  npx tsx e2e/offline.ts
 * S'obre amb connexió (el service worker guarda la còpia), es comença una partida, es talla la connexió
 * i es recarrega la pàgina (com lliscar avall): ha de tornar a sortir la partida, amb el diccionari.
 */
import { launch, phone, URL } from "./lib";

const errors: string[] = [];
const browser = await launch();
const { ctx, page } = await phone(browser, errors);

await page.goto(URL);
await page.getByText("Llesta per jugar sense connexió ✓").waitFor({ timeout: 15000 });
console.log("Amb connexió: llesta per jugar sense connexió");
await page.getByRole("button", { name: "Nova partida" }).click();
await page.getByRole("button", { name: "Comença" }).click();
await page.getByRole("button", { name: "Tots amb aquest mòbil" }).click();
await page.getByRole("button", { name: "Som-hi" }).click();

await ctx.setOffline(true);
await page.reload();
await page.getByRole("button", { name: "Continua la partida" }).waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Continua la partida" }).click();
await page.getByRole("button", { name: /^Sóc / }).waitFor();
console.log("Sense connexió, després de recarregar: partida recuperada i es pot continuar");
await page.close();

// I obrir-la de nou des de zero (com tocar la icona), sense connexió
const p2 = await ctx.newPage();
await p2.goto(URL);
await p2.getByRole("button", { name: "Continua la partida" }).waitFor({ timeout: 10000 });
console.log("Sense connexió, obrint-la de nou: partida recuperada");
const real = errors.filter(e => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/.test(e));
console.log(real.length ? real : "Cap error.");
await browser.close();
