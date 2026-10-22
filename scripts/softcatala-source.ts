/**
 * Prepara la font del diccionari ampliat a partir de Softcatalà (D-37).
 *   npx tsx scripts/softcatala-source.ts <ruta a resultats/lt/diccionari.txt> <commit>
 * Entrada:  diccionari.txt de github.com/Softcatala/catalan-dict-tools (forma lema etiqueta)
 * Sortida:  lexicon/source/softcatala-formes.txt.gz (formes en majúscules, sense accents, ordenades)
 *           lexicon/source/softcatala.json (commit i recompte)
 * Es fa una sola vegada per versió: el fitxer original fa 39 MB i no va al repositori.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "fflate";

const [path, commit] = process.argv.slice(2);
if (!path || !commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("Ús: softcatala-source.ts <diccionari.txt> <commit de 40 caràcters>");

/** Com el DISC: majúscules, sense accents ni dièresis; la Ç i el punt volat es mantenen. */
export function normalize(form: string): string {
  let out = "";
  for (const ch of form.replace(/ŀl/g, "l·l").replace(/Ŀl/g, "L·L").toUpperCase()) {
    out += ch === "Ç" || ch === "·" ? ch : ch.normalize("NFD")[0]!;
  }
  return out;
}

const forms = new Set<string>();
for (const line of readFileSync(path, "utf8").split("\n")) {
  const [form, , tag] = line.split(" ");
  if (!form || !tag) continue;
  // Fora: noms propis (NP), xifres i dates (Z), puntuació (F) i formes que comencen en majúscula (sigles, topònims)
  if (tag.startsWith("NP") || tag.startsWith("Z") || tag.startsWith("F")) continue;
  if (form[0] !== form[0]!.toLowerCase()) continue;
  const n = normalize(form);
  if (/^[A-ZÇ·]+$/.test(n)) forms.add(n);
}
const sorted = [...forms].sort();
writeFileSync("lexicon/source/softcatala-formes.txt.gz", gzipSync(new TextEncoder().encode(sorted.join("\n") + "\n"), { level: 9, mtime: 0 }));
writeFileSync("lexicon/source/softcatala.json", JSON.stringify({
  font: "Softcatalà, catalan-dict-tools (resultats/lt/diccionari.txt)",
  repositori: "https://github.com/Softcatala/catalan-dict-tools",
  commit,
  llicencia: "LGPL-2.1 (també GPL-2); aquí es fa servir com a LGPL-2.1, compatible amb GPL-3.0-or-later",
  formes: sorted.length,
}, null, 2) + "\n");
console.log({ formes: sorted.length });
