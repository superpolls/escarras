/**
 * Prova de la benvinguda (D-33): surt el primer cop, amb les instruccions de cada mòbil,
 * desapareix després de «Ho entenc» i no torna. També comprova la pantalla d'informació i el manifest.
 * Ús: E2E_WELCOME=1 npx tsx e2e/welcome.ts (amb `vite preview` en marxa)
 */
import { launch, OUT, URL } from "./lib";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

const browser = await launch();
const errors: string[] = [];
const fail = (m: string) => { errors.push(m); };

for (const [label, ua, expect] of [["iphone", IPHONE, "Afegeix a la pantalla d'inici"], ["android", ANDROID, "Instal·la l'aplicació"]] as const) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", e => fail(`${label} ${e.message}`));
  page.on("console", m => { if (m.type() === "error") fail(`${label} ${m.text()}`); });
  await page.goto(URL);
  await page.getByRole("button", { name: "Ho entenc" }).waitFor();
  const text = await page.locator("main").innerText();
  if (!text.includes(expect)) fail(`${label}: falten les instruccions («${expect}»)`);
  if (!text.includes("7 dies") && label === "iphone") fail("iphone: falta el motiu dels 7 dies");
  if (label === "iphone" && !text.includes("abans de començar")) fail("iphone: falta l'avís d'instal·lar abans de començar");
  await page.screenshot({ path: `${OUT}/welcome-${label}.png`, fullPage: true });
  await page.getByRole("button", { name: "Ho entenc" }).click();
  await page.getByRole("button", { name: "Nova partida" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Nova partida" }).waitFor();
  if (await page.getByRole("button", { name: "Ho entenc" }).count()) fail(`${label}: la benvinguda torna a sortir`);
  if (label === "iphone") {
    await page.getByRole("button", { name: "Informació i avís" }).click();
    await page.getByRole("heading", { name: "Informació" }).waitFor();
    const info = await page.locator("main").innerText();
    for (const t of ["sota la teva responsabilitat", "https://superpolls.github.io/escarras/app/", "Versió 0.", "GPL-3.0"]) if (!info.includes(t)) fail(`info: falta «${t}»`);
    await page.screenshot({ path: `${OUT}/info.png`, fullPage: true });
  }
  await ctx.close();
}

// Una invitació oberta per primer cop: primer la benvinguda, després continua cap a unir-se
{
  const ctx = await browser.newContext({ userAgent: ANDROID, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", e => fail(`invitació ${e.message}`));
  await page.goto(`${URL}#j=AAAAAAAAAAAAAAAAAAAAAA`);
  await page.getByRole("button", { name: "Ho entenc" }).waitFor();
  await ctx.close();
}

// Manifest i icones
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const r = await page.goto(`${URL}manifest.webmanifest`);
  const m = (await r!.json()) as { display: string; icons: { src: string }[] };
  if (m.display !== "standalone") fail("manifest: display");
  for (const i of m.icons) if (!(await page.request.get(`${URL}${i.src}`)).ok()) fail(`icona ${i.src}`);
  await ctx.close();
}

await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("benvinguda: OK");
