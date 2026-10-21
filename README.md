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

# Proves al navegador (mòbils simulats) contra un servidor fals de Firebase
npx tsx tests/fake-rtdb.ts 9400 &
VITE_RTDB_URL=http://127.0.0.1:9400 npm run build && npx vite preview --port 4173 &
npx tsx e2e/m3.ts && npx tsx e2e/approve.ts && npx tsx e2e/multi.ts
npm run build       # torna a compilar amb el Firebase de debò abans de publicar
```

- `src/core/`: motor del joc (pur, sense pantalla ni xarxa).
- `src/sync/`: sincronització entre mòbils (paquet, QR, xifratge, servidor, fusió de versions).
- `src/ui/`: interfície (Preact).
- `firebase/database.rules.json`: regles de la base de dades (es copien a la consola de Firebase).
- `DECISIONS.md`: decisions de disseny i interpretacions del reglament.
- `docs/APRENENTATGE.md`: diari d'aprenentatge.

Diccionari: DISC 2.18.25 de Joan Montané (GPLv3 / CC-BY-SA 3.0).
