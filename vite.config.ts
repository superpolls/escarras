import { readFileSync } from "node:fs";
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
    "media-src 'self' blob:",
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

// L'app es publica a GitHub Pages a /escarras/app/ (D-18)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    root: "web",
    base: "/escarras/app/",
    publicDir: "../public",
    plugins: [preact(), csp(serverFrom(env.VITE_RTDB_URL))],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: { outDir: "../app", emptyOutDir: true, target: "es2020" },
  };
});
