/**
 * Service worker de l'Escarràs (D-44). vite.config.ts hi posa el nom de la memòria i la llista de fitxers.
 * - En instal·lar-se, guarda tots els fitxers de l'app.
 * - Obrir l'app: primer la xarxa (per tenir la versió nova); si no n'hi ha, la còpia guardada.
 * - La resta (codi, diccionaris, icones): la còpia guardada; si no hi és, la xarxa. Sense mirar «Vary»: l'script
 *   de l'app es demana amb la capçalera Origin i, si el servidor respon «Vary: Origin», no es trobaria.
 * - Les peticions al servidor de la partida (un altre domini) no es toquen.
 */
const CACHE = "escarras-0.4.0-fee5356cce";
const FILES = ["/escarras/app/","/escarras/app/assets/index-BTAhSV8V.css","/escarras/app/assets/index-Bqk3M4BI.js","/escarras/app/icon-180.png","/escarras/app/icon-192.png","/escarras/app/icon-512.png","/escarras/app/icon-maskable-512.png","/escarras/app/lexicon-softcatala.bin","/escarras/app/lexicon.bin","/escarras/app/manifest.webmanifest"];
const INDEX = "/escarras/app/";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("escarras-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(INDEX)) return;
  if (req.mode === "navigate") { e.respondWith(openApp(req)); return; }
  e.respondWith(caches.match(req, { ignoreSearch: true, ignoreVary: true }).then(hit => hit || fetch(req)));
});

/** Xarxa primer, amb un límit de temps perquè amb poca cobertura no es quedi esperant. */
async function openApp(req) {
  try {
    const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("temps")), 4000))]);
    if (res.ok) return res;
    throw new Error(String(res.status));
  } catch {
    const cache = await caches.open(CACHE);
    return (await cache.match(INDEX, { ignoreVary: true })) ?? Response.error();
  }
}
