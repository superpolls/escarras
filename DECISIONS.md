# Decisions

Registre de decisions de disseny: data, decisió, motiu i alternativa descartada.

| # | Data | Decisió | Motiu | Alternativa descartada |
|---|---|---|---|---|
| D-01 | 2026-10-21 | Cada estat publicat té un número de versió `seq` que puja en cada canvi (també en desfer). Gana la versió més alta verificada; el servidor només accepta `seq` = actual + 1 | Un sol comptador serialitza jugades i desfers; dues versions amb el mateix `seq` i contingut diferent són una bifurcació detectable | Parella torn + revisió (més casos especials) |
| D-02 | 2026-10-21 | Empremta = 8 primers bytes del SHA-256 de la forma canònica | Detectar errors i bifurcacions; la seguretat en línia la dona el xifratge AES-GCM | 32 bytes (més QR sense guany pràctic) |
| D-03 | 2026-10-21 | Senyors a l'atril inicial: canvi automàtic. Durant la partida: opcional, just després de robar, dins la mateixa publicació. Després del procediment de la 3a vegada ja no es pot tornar a canviar | Un sol escriptor per torn: a l'inici ningú no té el torn | Oferir-ho a l'inici del primer torn de cadascú |
| D-04 | 2026-10-21 | QU compta com a consonant per als senyors | No és vocal; supòsit pendent de confirmar | — |
| D-05 | 2026-10-21 | Bloqueig: final quan hi ha 3 × jugadors torns seguits amb 0 punts (jugades de 0 punts incloses) | Generalitza el punt 22 (pensat per a 2 jugadors) a 3 rondes completes | Comptar només passar i canviar |
| D-06 | 2026-10-21 | Canvi de fitxes: primer es roben les noves, després les descartades tornen a la bossa, que es remena amb el generador | Punt 34 | Retornar abans de robar |
| D-07 | 2026-10-21 | Sorteig d'inici simulat amb el generador; les fitxes tornen a la bossa, que es remena; repartiment en ordre de joc; màxim 15 rondes de desempat | Punts 3 i 5; tots els mòbils el calculen igual | — |
| D-08 | 2026-10-21 | Noms de fins a 12 caràcters. Durant la partida només el jugador que juga pot canviar el seu, i el canvi viatja amb la seva jugada | Un sol escriptor per torn | Canvis de nom per qualsevol mòbil en qualsevol moment |
| D-09 | 2026-10-21 | La versió del lèxic no va a l'estat; la porta el manifest de l'app | Estalvia bytes al QR | — |
| D-10 | 2026-10-21 | SHA-256 propi i síncron, verificat contra el de Node | El motor ha de ser síncron; `crypto.subtle` és asíncron | `crypto.subtle` |
| D-11 | 2026-10-21 | Diccionari base: DISC 2.18.25 sense afegits; mostra dialectal de 71 formes coberta al 100 % | Llicència GPLv3 / CC-BY-SA 3.0; sincronitzat amb el DIEC2 | DOSC (propietari) |
