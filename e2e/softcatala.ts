/**
 * Prova al navegador de l'opció «També Softcatalà» (D-37).
 *   npx tsx tests/fake-rtdb.ts 9400 &  ;  npx vite preview --port 4173 &  ;  npx tsx e2e/softcatala.ts
 * Crea dues partides: per defecte (només DISC) i amb Softcatalà, i comprova què queda desat i què es mostra.
 */
import { launch, OUT, phone, state, URL } from "./lib";

const errors: string[] = [];
const browser = await launch();

for (const ampliat of [false, true]) {
  const { ctx, page } = await phone(browser, errors, ampliat ? "softcatala" : "disc");
  await page.goto(URL);
  await page.getByRole("button", { name: "Nova partida" }).click();
  if (ampliat) await page.getByRole("button", { name: "També Softcatalà" }).click();
  await page.screenshot({ path: `${OUT}/softcatala-${ampliat ? "si" : "no"}.png` });
  await page.getByRole("button", { name: "Comença" }).click();
  await page.getByRole("button", { name: "Tots amb aquest mòbil" }).click();
  const text = ampliat ? "també les de Softcatalà" : "només les oficials";
  await page.getByText(text).waitFor();
  const s = await state(page);
  if (s.softcatala !== ampliat) throw new Error(`L'estat desat diu softcatala=${s.softcatala}`);
  await ctx.close();
}

await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
console.log("Softcatalà: OK");
