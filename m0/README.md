# M0 · Prova del QR

Pàgina autònoma per comprovar que un mòbil llegeix el QR d'un altre amb la mida que tindrà l'estat de la partida.

- `index.html`: genera QR de 200, 270 i 540 bytes (Base45, correcció M) i els llegeix amb la càmera (lector natiu si n'hi ha; si no, jsQR).
- `vendor/`: llibreries incloses al repositori perquè funcioni sense xarxa: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT) i [jsQR](https://github.com/cozmo/jsQR) 1.4.0 (Apache-2.0).

La càmera només funciona si la pàgina se serveix per HTTPS.

## Protocol de prova

1. Mòbil A: «Mostra el codi», tria una mida. Mòbil B: «Llegeix el codi», tria el lloc i obre la càmera.
2. Repetir per a cada mida i cada lloc (interior, cotxe de dia, cotxe de nit, al sol), en tots dos sentits (iPhone → Android i Android → iPhone).
3. Criteri: ≥ 95 % de lectures correctes a la primera i < 3 s de mitjana per a la mida «pitjor cas previst».
