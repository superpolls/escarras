# escarràs

Joc de paraules encreuades en català, per jugar en família o amb amics, cadascú amb el seu mòbil i també sense connexió.

- **Jugar:** https://superpolls.github.io/escarras/app/
- **Prova del QR (M0):** https://superpolls.github.io/escarras/m0/

> **Versió beta.** Escarràs és gratuït, de codi obert i sense ànim de lucre. S'ofereix «tal com és», sense cap garantia, i es fa servir sota la responsabilitat de cada usuari. L'única versió oficial és la de l'adreça de dalt; les còpies modificades per tercers no són responsabilitat de l'autor. L'app mai demana contrasenyes, dades ni pagaments.

## Per a desenvolupament

```bash
npm install
npm test            # tests del motor i del lèxic (Vitest)
npm run lexicon     # reconstrueix public/lexicon.bin (DISC) i public/lexicon-softcatala.bin (D-37)
# Nova versió de Softcatalà: clona Softcatala/catalan-dict-tools i
#   npx tsx scripts/softcatala-source.ts <repo>/resultats/lt/diccionari.txt <commit>
# i actualitza SC_SHA256 a scripts/build-lexicon.ts
npm run dev         # servidor local
npm run build       # genera app/ (es publica amb GitHub Pages)

# Proves al navegador (mòbils simulats) contra un servidor fals de Firebase
npx tsx tests/fake-rtdb.ts 9400 &
VITE_RTDB_URL=http://127.0.0.1:9400 npm run build && npx vite preview --port 4173 &
npx tsx e2e/m3.ts && npx tsx e2e/approve.ts && npx tsx e2e/multi.ts && npx tsx e2e/softcatala.ts && npx tsx e2e/ghost.ts && npx tsx e2e/peek.ts && npx tsx e2e/offline.ts
E2E_WELCOME=1 npx tsx e2e/welcome.ts
npm run build       # torna a compilar amb el Firebase de debò abans de publicar
```

- `src/core/`: motor del joc (pur, sense pantalla ni xarxa).
- `src/sync/`: sincronització entre mòbils (paquet, QR, xifratge, servidor, fusió de versions).
- `src/ui/`: interfície (Preact).
- `firebase/database.rules.json`: regles de la base de dades (es copien a la consola de Firebase).
- `DECISIONS.md`: decisions de disseny i interpretacions del reglament.
- `docs/APRENENTATGE.md`: diari d'aprenentatge.

Codi: GPL-3.0-or-later (`LICENSE`). Diccionari: DISC 2.18.25 de Joan Montané (GPLv3 / CC-BY-SA 3.0). Diccionari ampliat opcional: [catalan-dict-tools](https://github.com/Softcatala/catalan-dict-tools) de Softcatalà (LGPL-2.1).
