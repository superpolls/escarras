import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { serverFrom } from "./src/server";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

/**
 * Política de seguretat del contingut (CSP), només a la versió compilada (D-35).
 * L'app només pot carregar codi propi i només pot parlar amb la seva web i amb el servidor de la partida.
 * Es calcula a partir de VITE_RTDB_URL perquè les proves amb un servidor fals continuïn funcionant.
 */
function csp(server: string | null): Plugin {
  const connect = ["'self'", ...(server ? [new URL(server).origin] : [])].join(" ");
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:", // mediastream: és la càmera a Safari
    `connect-src ${connect}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "escarras-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" }],
  };
}

/**
 * Service worker (D-44): guarda l'app sencera (codi, estils, diccionaris, icones) perquè s'obri sense connexió.
 * Es genera en compilar, amb la llista exacta de fitxers; el nom de la memòria canvia a cada versió.
 */
function serviceWorker(base: string, version: string): Plugin {
  return {
    name: "escarras-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = ["", ...Object.keys(bundle), ...readdirSync("public")].sort().map(f => base + f);
      const cache = `escarras-${version}-${createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 10)}`;
      const source = readFileSync("src/sw.js", "utf8")
        .replace("__CACHE__", cache)
        .replace("__FILES__", JSON.stringify(files))
        .replace("__INDEX__", JSON.stringify(base));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// L'app es publica a GitHub Pages a /escarras/app/ (D-18)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    root: "web",
    base: "/escarras/app/",
    publicDir: "../public",
    plugins: [preact(), csp(serverFrom(env.VITE_RTDB_URL)), serviceWorker("/escarras/app/", pkg.version)],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: { outDir: "../app", emptyOutDir: true, target: "es2020" },
  };
});
