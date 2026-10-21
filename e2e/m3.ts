/**
 * Prova de la interfície (M3) en un navegador real, en mida de mòbil.
 *   npx vite preview --port 4173 &  ;  npx tsx e2e/m3.ts
 * Juga una partida curta: primera paraula, canvi, desfer, passar, escarràs si n'hi ha, i comprova que no hi ha errors.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { decodeState } from "../src/core/codec";
import { checkPlay, currentPlayer } from "../src/core/game";
import { Lexicon } from "../src/core/lexicon";
import type { GameState, Placement } from "../src/core/types";

const URL = "http://localhost:4173/escarras/app/";
const OUT = process.env.SHOTS ?? "e2e/shots";
mkdirSync(OUT, { recursive: true });
const lex = Lexicon.fromBytes(readFileSync("public/lexicon.bin"));
const isWord = (t: readonly number[]) => lex.has(t);

async function state(page: Page): Promise<GameState> {
  const raw = await page.evaluate(() => localStorage.getItem("escarras-partida-v1"));
  const j = JSON.parse(raw!);
  return decodeState(Uint8Array.from(Buffer.from(j.state, "base64")));
}

/** Busca la millor primera jugada horitzontal que passi per H8 (sense escarrassos, per simplicitat). */
function firstMove(s: GameState): { slots: number[]; cells: number[] } | null {
  const rack = s.players[currentPlayer(s)]!.rack;
  let best: { slots: number[]; cells: number[]; score: number } | null = null;
  const rec = (slots: number[]) => {
    if (slots.length >= 2) {
      for (let start = 112 - slots.length + 1; start <= 112; start++) {
        if (Math.floor(start / 15) !== 7 || Math.floor((start + slots.length - 1) / 15) !== 7) continue;
        const placements: Placement[] = slots.map((sl, k) => ({ index: start + k, tile: rack[sl]!, letter: rack[sl]! }));
        if (placements.some(p => p.tile === 0)) continue;
        const c = checkPlay(s, placements, isWord);
        if (c.ok && (!best || c.result.score > best.score)) best = { slots: [...slots], cells: placements.map(p => p.index), score: c.result.score };
      }
    }
    if (slots.length === rack.length || slots.length === 5) return;
    for (let i = 0; i < rack.length; i++) if (!slots.includes(i)) rec([...slots, i]);
  };
  rec([]);
  return best;
}

const errors: string[] = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(URL);
await page.getByRole("button", { name: "Nova partida" }).click();
await page.getByRole("button", { name: "3", exact: true }).click();
await page.getByLabel("Nom del jugador 1").fill("Núria");
await page.screenshot({ path: `${OUT}/1-config.png` });
await page.getByRole("button", { name: "Comença" }).click();
await page.screenshot({ path: `${OUT}/2-sorteig.png` });
await page.getByRole("button", { name: "Som-hi" }).click();
await page.screenshot({ path: `${OUT}/3-passa.png` });
await page.getByRole("button", { name: /^Sóc / }).click();

let s = await state(page);
const move = firstMove(s);
if (!move) throw new Error("No he trobat cap primera jugada");

/** Arrossega una fitxa de l'atril a una casella, com ho faria un dit (la fitxa es veu 44 px per sobre del dit). */
async function dragTo(slot: number, cell: number, shot?: string) {
  const from = (await page.locator(`.rack button[data-slot="${slot}"]`).boundingBox())!;
  const to = (await page.locator(`[data-i="${cell}"]`).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const tx = to.x + to.width / 2, ty = to.y + to.height / 2 + 44;
  for (let k = 1; k <= 8; k++) await page.mouse.move(from.x + (tx - from.x) * k / 8, from.y + (ty - from.y) * k / 8);
  if (shot) await page.screenshot({ path: shot });
  await page.mouse.up();
}

// Reordenar l'atril: la primera fitxa, arrossegada fins al final de l'atril
const slotsShown = () => page.locator(".rack button").evaluateAll(bs => bs.map(b => b.getAttribute("data-slot")));
const rackBefore = await slotsShown();
const a = (await page.locator(".rack button").first().boundingBox())!;
const z = (await page.locator(".rack button").last().boundingBox())!;
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();
const endX = z.x + z.width - 4; // a la dreta de l'última fitxa
for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + a.width / 2 + (endX - a.x - a.width / 2) * k / 8, a.y + a.height / 2);
await page.mouse.up();
const rackAfter = await slotsShown();
console.log("Atril abans:", rackBefore.join(","), "· després de reordenar:", rackAfter.join(","));
if (rackAfter.at(-1) !== rackBefore[0]) throw new Error("No s'ha reordenat l'atril");
await page.reload();
await page.getByRole("button", { name: "Continua la partida" }).click();
await page.getByRole("button", { name: /^Sóc / }).click();
console.log("Ordre conservat després de recarregar:", (await slotsShown()).join(",") === rackAfter.join(","));

// Primera fitxa arrossegada: sola no és vàlida (cal un mínim de 2) → vermella
await dragTo(move.slots[0]!, move.cells[0]!, `${OUT}/4a-arrossegant.png`);
console.log("Fitxes vermelles amb una sola fitxa:", await page.locator(".cell.pending.bad").count());
// La resta, també arrossegant → la jugada és vàlida → verdes
for (let k = 1; k < move.slots.length; k++) await dragTo(move.slots[k]!, move.cells[k]!);
console.log("Fitxes verdes amb la paraula completa:", await page.locator(".cell.pending.good").count(), "de", move.slots.length);
// Moure una fitxa ja posada a un lloc dolent i tornar-la
const firstCell = (await page.locator(`[data-i="${move.cells[0]}"]`).boundingBox())!;
const away = (await page.locator(`[data-i="${move.cells[0]! - 75}"]`).boundingBox())!; // 5 files amunt
await page.mouse.move(firstCell.x + firstCell.width / 2, firstCell.y + firstCell.height / 2);
await page.mouse.down();
for (let k = 1; k <= 8; k++) await page.mouse.move(firstCell.x + (away.x - firstCell.x) * k / 8 + away.width / 2, firstCell.y + (away.y + 44 - firstCell.y) * k / 8 + away.height / 2);
await page.mouse.up();
console.log("Després de moure una fitxa lluny: vermelles", await page.locator(".cell.pending.bad").count());
await page.screenshot({ path: `${OUT}/4b-vermelles.png` });
await page.getByRole("button", { name: "Recull" }).click();
for (let k = 0; k < move.slots.length; k++) await dragTo(move.slots[k]!, move.cells[k]!);
await page.screenshot({ path: `${OUT}/4-jugada-pendent.png` });
const statusText = await page.locator(".status").innerText();
console.log("Estat abans de jugar:", statusText);
await page.getByRole("button", { name: "Juga" }).click();
// Si surten senyors, me les quedo
if (await page.getByRole("button", { name: "Me les quedo" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "Me les quedo" }).click();
await page.screenshot({ path: `${OUT}/5-traspas.png` });
s = await state(page);
console.log("Després de jugar:", s.players.map(p => `${p.name} ${p.score}`).join(" · "), "· torn de", s.players[s.current]!.name);

// Desfer i tornar a jugar
await page.getByRole("button", { name: /desfés la jugada/ }).click();
s = await state(page);
console.log("Després de desfer: punts", s.players.map(p => p.score).join(","), "· tauler buit:", s.board.every(c => !c));
for (let k = 0; k < move.slots.length; k++) {
  await page.locator(`.rack button[data-slot="${move.slots[k]}"]`).click();
  await page.locator(`[data-i="${move.cells[k]}"]`).click();
}
await page.getByRole("button", { name: "Juga" }).click();
if (await page.getByRole("button", { name: "Me les quedo" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "Me les quedo" }).click();

// Jugador 2: canvia dues fitxes
await page.getByRole("button", { name: /^Sóc / }).click();
await page.getByRole("button", { name: "Canvia", exact: true }).click();
await page.locator(".rack button").nth(0).click();
await page.locator(".rack button").nth(1).click();
await page.screenshot({ path: `${OUT}/6-canvi.png` });
await page.getByRole("button", { name: /^Canvia 2/ }).click();
if (await page.getByRole("button", { name: "Me les quedo" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "Me les quedo" }).click();

// Jugador 3: prova una jugada no vàlida, amplia el tauler i passa
await page.getByRole("button", { name: /^Sóc / }).click();
await page.locator(".rack button").nth(0).click();
await page.locator(`[data-i="0"]`).click();
console.log("Missatge d'error:", await page.locator(".status").innerText());
await page.getByRole("button", { name: "Amplia" }).click();
await page.screenshot({ path: `${OUT}/7-amplia-error.png` });
await page.getByRole("button", { name: "Recull" }).click();
await page.getByRole("button", { name: "Redueix" }).click();
await page.getByRole("button", { name: "Passa" }).click();
await page.screenshot({ path: `${OUT}/8-confirma-passa.png` });
await page.locator(".modal").getByRole("button", { name: "Passa" }).click();

// Escarràs: si el jugador 1 en té, comprova la finestra de lletres
await page.getByRole("button", { name: /^Sóc / }).click();
s = await state(page);
const blankSlot = s.players[s.current]!.rack.indexOf(0);
if (blankSlot >= 0) {
  await page.locator(`.rack button[data-slot="${blankSlot}"]`).click();
  await page.locator(`[data-i="${s.board.findIndex(c => c) - 15}"]`).click();
  await page.screenshot({ path: `${OUT}/9-escarras.png` });
  await page.getByRole("button", { name: "Cancel·la" }).click();
}
await page.screenshot({ path: `${OUT}/10-joc.png` });

// Recarregar: la partida continua
await page.reload();
await page.getByRole("button", { name: "Continua la partida" }).click();
const after = await state(page);
console.log("Després de recarregar, versió", after.seq, "· codi visible:", await page.locator(".handoff h1").innerText());

// Final de partida: es prepara una partida bloquejada (6 passades) i es comprova la pantalla final
const { createGame, applyAction } = await import("../src/core/game");
const { encodeState } = await import("../src/core/codec");
let g = createGame({ gameId: "ab".repeat(16), seed: new Uint8Array(16).fill(5), names: ["Anna", "Biel"] });
g.players[0]!.score = 120;
g.players[1]!.score = 98;
for (let i = 0; i < 6; i++) g = applyAction(g, { type: "pass" }, isWord);
await page.evaluate(v => localStorage.setItem("escarras-partida-v1", JSON.stringify({ state: v, prev: null })), Buffer.from(encodeState(g)).toString("base64"));
await page.reload();
await page.getByRole("button", { name: "Resultat de l'última partida" }).click();
await page.screenshot({ path: `${OUT}/11-final.png` });
console.log("Final:", g.ended, g.players.map(p => `${p.name} ${p.score}`).join(" · "));

await browser.close();
console.log(errors.length ? `ERRORS: ${errors.join(" | ")}` : "Cap error a la consola.");
process.exit(errors.length ? 1 : 0);
