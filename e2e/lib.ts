/** Utilitats de les proves al navegador. */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { checkPlay, currentPlayer } from "../src/core/game";
import { Lexicon } from "../src/core/lexicon";
import type { GameState, Placement } from "../src/core/types";
import { headOf } from "../src/sync/replica";
import { loadSaved } from "../src/sync/session";

export const URL = "http://localhost:4173/escarras/app/";
export const OUT = process.env.SHOTS ?? "e2e/shots";
mkdirSync(OUT, { recursive: true });
export const lex = Lexicon.fromBytes(readFileSync("public/lexicon.bin"));
export const isWord = (t: readonly number[]) => lex.has(t);

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
}

/** Escriptures rebutjades pel candau del servidor: normals quan dos mòbils publiquen alhora. */
export const denied = { count: 0 };

export async function phone(browser: Browser, errors: string[], label = ""): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${label} ${e.message}`));
  page.on("console", m => {
    // Les desconnexions provocades a propòsit no són errors de l'app
    if (m.type() !== "error") return;
    if (/status of 401/.test(m.text())) { denied.count += 1; return; }
    if (!/ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED|net::ERR_FAILED/.test(m.text())) errors.push(`${label} ${m.text()}`);
  });
  return { ctx, page };
}

/** Estat actual de la partida desada en aquest navegador. */
export async function state(page: Page): Promise<GameState> {
  const raw = await page.evaluate(() => localStorage.getItem("escarras-partida-v2"));
  return headOf(loadSaved(raw!).replica);
}

export async function seats(page: Page): Promise<number[]> {
  const raw = await page.evaluate(() => localStorage.getItem("escarras-partida-v2"));
  return loadSaved(raw!).replica.seats;
}

/** La millor primera jugada horitzontal que passa per H8 (sense escarrassos). */
export function firstMove(s: GameState, valid = isWord): { slots: number[]; cells: number[] } | null {
  const rack = s.players[currentPlayer(s)]!.rack;
  let best: { slots: number[]; cells: number[]; score: number } | null = null;
  const rec = (slots: number[]) => {
    if (slots.length >= 2) {
      for (let start = 112 - slots.length + 1; start <= 112; start++) {
        if (Math.floor(start / 15) !== 7 || Math.floor((start + slots.length - 1) / 15) !== 7) continue;
        const placements: Placement[] = slots.map((sl, k) => ({ index: start + k, tile: rack[sl]!, letter: rack[sl]! }));
        if (placements.some(p => p.tile === 0)) continue;
        const c = checkPlay(s, placements, valid);
        if (c.ok && (!best || c.result.score > best.score)) best = { slots: [...slots], cells: placements.map(p => p.index), score: c.result.score };
      }
    }
    if (slots.length === rack.length || slots.length === 5) return;
    for (let i = 0; i < rack.length; i++) if (!slots.includes(i)) rec([...slots, i]);
  };
  rec([]);
  return best;
}

/** Col·loca fitxes tocant fitxa i casella. */
export async function place(page: Page, move: { slots: number[]; cells: number[] }): Promise<void> {
  for (let k = 0; k < move.slots.length; k++) {
    await page.locator(`.rack button[data-slot="${move.slots[k]}"]`).click();
    await page.locator(`[data-i="${move.cells[k]}"]`).click();
  }
}

export async function keepSenyors(page: Page): Promise<void> {
  if (await page.getByRole("button", { name: "Me les quedo" }).isVisible().catch(() => false)) await page.getByRole("button", { name: "Me les quedo" }).click();
}

export async function waitUntil(cond: () => Promise<boolean>, ms = 10000, what = "condició"): Promise<void> {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error(`Temps esgotat esperant: ${what}`);
    await new Promise(r => setTimeout(r, 100));
  }
}
