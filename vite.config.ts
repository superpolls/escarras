import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// L'app es publica a GitHub Pages a /escarras/app/ (D-18)
export default defineConfig({
  root: "web",
  base: "/escarras/app/",
  publicDir: "../public",
  plugins: [preact()],
  build: { outDir: "../app", emptyOutDir: true, target: "es2020" },
});
