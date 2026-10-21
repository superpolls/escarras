# escarràs

Joc de paraules encreuades en català, per jugar en família o amb amics, cadascú amb el seu mòbil i també sense connexió.

- **Jugar:** https://superpolls.github.io/escarras/app/
- **Prova del QR (M0):** https://superpolls.github.io/escarras/m0/

## Per a desenvolupament

```bash
npm install
npm test            # tests del motor i del lèxic (Vitest)
npm run lexicon     # reconstrueix public/lexicon.bin a partir del DISC
npm run dev         # servidor local
npm run build       # genera app/ (es publica amb GitHub Pages)
npx vite preview --port 4173 & npx tsx e2e/m3.ts   # prova al navegador en mida de mòbil
```

- `src/core/`: motor del joc (pur, sense pantalla ni xarxa).
- `src/ui/`: interfície (Preact).
- `DECISIONS.md`: decisions de disseny i interpretacions del reglament.
- `docs/APRENENTATGE.md`: diari d'aprenentatge.

Diccionari: DISC 2.18.25 de Joan Montané (GPLv3 / CC-BY-SA 3.0).
