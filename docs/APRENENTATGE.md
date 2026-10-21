# Escarràs · Diari d'aprenentatge

Conceptes que surten durant el projecte, explicats breument. S'hi afegeix una entrada a cada pas.

## 1. Les peces del projecte

| Peça | Què és | Analogia |
|---|---|---|
| Repositori Git (GitHub) | Historial de tots els canvis del codi: qui, quan i per què | Control de revisions d'un plànol |
| Commit | Una fotografia del projecte amb un missatge que explica el canvi | Una revisió signada |
| Push | Pujar els commits locals a GitHub | Enviar la revisió a l'arxiu central |
| TypeScript | JavaScript amb tipus verificats abans d'executar | Comprovar cotes abans de fabricar |
| Tests | Programes que comproven automàticament que el codi fa el que ha de fer | Banc de proves amb casos coneguts |
| PWA + Service Worker | Web que s'instal·la al mòbil i funciona sense xarxa | Firmware desat al dispositiu |

**Autoritzar vs. instal·lar una app de GitHub:** autoritzar (OAuth) diu *qui ets*; instal·lar diu *a quins repositoris pot entrar*. Calen tots dos. Principi del mínim privilegi: donar accés només al repositori necessari.

## 2. M0 · Prova del QR

**Per què primer:** és la hipòtesi més arriscada i la més barata de provar (*pretotyping*). Si el QR no es llegeix bé entre mòbils, cal canviar el disseny abans d'escriure la resta.

**Què fa que un QR es llegeixi bé**
- **Quantitat de dades → versió.** Versió 1 = 21×21 quadrets; cada versió en suma 4 per costat, fins a la 40 (177×177). Més quadrets al mateix espai = quadrets més petits = lectura més difícil.
- **Correcció d'errors (Reed-Solomon).** El QR porta dades redundants per reconstruir parts danyades o mal llegides. Nivells L (7 %), M (15 %), Q (25 %), H (30 %). Fem servir **M**: bon equilibri entre robustesa i mida.
- **Mode de codificació.** Numèric, alfanumèric (0-9, A-Z, espai i `$%*+-./:`) o binari. L'alfanumèric guarda 2 caràcters en 11 bits; és més compacte que el binari per a aquest tipus de text.
- **Zona blanca (*quiet zone*).** Un marge blanc de 4 quadrets al voltant és obligatori perquè el lector trobi el codi.

**Base45:** converteix bytes en text fet només amb els 45 caràcters del mode alfanumèric. Cada 2 bytes es converteixen en 3 caràcters (+50 %), però el QR els guarda de manera eficient. És el que feien servir els certificats COVID.

**Suma de control:** uns quants bytes calculats a partir de les dades. Qui rep el codi la torna a calcular; si no coincideix, les dades s'han alterat. El QR ja corregeix errors; la suma de control és una segona comprovació, independent.

**Resultats al navegador de l'ordinador (sense càmera)**

| Mida | Caràcters | Versió QR | Quadrets |
|---|---|---|---|
| 200 bytes | 305 | 10 | 57×57 |
| 270 bytes (pitjor cas previst) | 410 | 12 | 65×65 |
| 540 bytes (doble) | 815 | 18 | 89×89 |

Falta la prova real: dos mòbils, a casa, al cotxe i al sol.

**Per què la càmera necessita HTTPS:** els navegadors només deixen fer servir la càmera a pàgines servides de manera xifrada (HTTPS), per seguretat. Per això cal publicar la pàgina; obrir el fitxer directament al mòbil no funcionaria.

## 3. El diccionari (DISC)

- Versió 2.18.25, 584.095 formes, en majúscules i sense accents.
- **Llicència lliure:** GPLv3 o CC-BY-SA 3.0, a elecció. Es pot fer servir i redistribuir citant l'autor (Joan Montané) i mantenint la mateixa llicència per al que en derivi.
- Format compatible amb el reglament: cap Y fora de NY, cap Q sense U, cap K ni W; la ela geminada apareix com a `L·L`.

## 4. M1 · El lèxic

**Problema:** 584.095 paraules en text ocupen 6,5 MB. El mòbil ha de comprovar una paraula en mil·lisegons, sense xarxa, i ocupar poc.

**Pas 1 · De lletres a fitxes.** Cada paraula es converteix a la seqüència de fitxes amb què es juga: `IL·LUS` → I · L·L · U · S (4 fitxes). Cada fitxa té un número (1 = A … 26 = Z), en ordre alfabètic català.

**Pas 2 · DAWG (graf acíclic dirigit de paraules).** Les paraules comparteixen principis (CANT-AR, CANT-EM) i finals (-ARIEM, -ARÍEU). Un DAWG les guarda com un graf on cada camí des de l'arrel és una paraula, i els trossos repetits es guarden només una vegada.
- Construcció: algorisme de Daciuk (2000). Les paraules entren ordenades; a mesura que s'avança, cada branca acabada es compara amb les ja guardades i, si n'hi ha una d'idèntica, es reutilitza.
- Cada aresta del graf ocupa 4 bytes: la fitxa, si és l'última del node, si hi acaba una paraula i on continua.
- Consultar una paraula = recórrer com a molt 15 nodes.

**Resultat**

| | Mida |
|---|---|
| Text del DISC | 6,5 MB |
| DAWG (110.869 arestes) | 443 KB |
| DAWG comprimit en la descàrrega (gzip) | 252 KB |

Es construeix en mig segon amb `npm run lexicon`. El script comprova primer l'empremta (sha256) del zip del DISC: si algú el canvia, no construeix res. Això fa que el resultat sigui **reproduïble**: la mateixa entrada dona sempre exactament el mateix fitxer.

**Pas 3 · Verificació (tests automàtics)**
- Les 584.095 formes del DISC hi són, i cap altra (es recorre tot el graf i es compara).
- 20.000 paraules inventades per mutació: el lèxic respon igual que la llista original.
- Barbarismes rebutjats. **Lliçó:** dues paraules que semblaven barbarismes (PUES, ACERA) són catalanes: plural de «pua» i forma d'«acerar». Abans de dir que una paraula no és vàlida, cal comprovar els homògrafs.
- Mostra de 71 formes valencianes i balears: totes hi són. **Lliçó:** tres errors de la primera mostra eren meus (PUGUERA → POGUERA, ESSE → EIXE): les llistes de prova també s'han de verificar contra una font.

**Què és un test automàtic:** un programa que crida el codi amb casos coneguts i compara el resultat amb l'esperat. S'executa cada vegada que es canvia alguna cosa (`npm test`). Si una regla es trenca, se sap a l'instant.

## 5. M2 · El motor del joc

**Codi pur.** El motor és una funció: *estat + jugada → estat nou*. No toca la pantalla, la xarxa ni el rellotge. Dos mòbils que apliquen la mateixa jugada al mateix estat obtenen exactament el mateix resultat, bit a bit.

**Generador determinista (xoshiro128\*\*).** Seqüència que sembla aleatòria però queda fixada per la llavor de 128 bits. Tots els mòbils barregen la bossa igual sense comunicar-se. S'ha comprovat que dona els mateixos números que la implementació de referència en C. Prohibit `Math.random`: cada navegador el fa diferent.

**Fisher-Yates.** Barreja recorrent la llista del final al principi i intercanviant cada element amb un de l'atzar dels que queden. Tots els ordres són igual de probables.

**Biaix del mòdul.** Per treure un número de 0 a 5 d'un generador de 32 bits, `x % 6` afavoreix lleugerament els números petits, perquè 2³² no és múltiple de 6. Es descarten els valors del tram final i es torna a tirar.

**Serialització canònica i empremta.** L'estat es converteix a bits sempre en el mateix ordre (unes 220-280 bytes). El SHA-256 d'aquests bytes és l'empremta. Cada estat porta l'empremta de l'anterior, i això forma una **cadena**: si algú canvia un estat antic, la cadena es trenca.

**Verificació per repetició.** El mòbil que rep una jugada la torna a aplicar amb el seu propi motor i comprova que el resultat és idèntic. Així detecta punts inflats, atrils canviats o jugades fora de torn sense necessitat de confiar en ningú.

**Simulació amb invariants.** 1.000 partides senceres amb jugades aleatòries. Després de cada jugada es comprova: sempre 100 fitxes amb la distribució oficial, cap atril de més de 7, la versió puja d'una en una, codificar i descodificar dona el mateix, i la verificació per repetició passa. Un invariant és una propietat que ha de ser certa sempre, passi el que passi.

**Lliçó 1 · un error real trobat per la simulació.** Una partida va fer canvis de senyors més de tres vegades seguides i el comptador no hi cabia. El reglament diu que, després del procediment de la tercera vegada, el jugador es queda les fitxes. Corregit, i amb un test nou.

**Lliçó 2 · un generador dolent amaga errors.** La primera simulació feia servir els bits baixos d'un generador congruencial lineal, que repeteixen un patró curt (0, 1, 2, 3, 0, 1…). Cap partida acabava per bloqueig i l'error anterior no apareixia. Amb els bits alts, va sortir de seguida. Els tests aleatoris també necessiten bon atzar.

**Decisions:** totes les interpretacions del reglament són a `DECISIONS.md`.

## 6. M2 bis · Jugadors que marxen i que entren

**Qui pot escriure què.** Abans, només el mòbil de qui té el torn podia modificar la partida. Ara algunes accions les fa una altra persona: abandonar i votar, des del mòbil de qui actua; acceptar qui entra, des del de qui té el torn. Cada acció només es pot fer des del mòbil del jugador afectat. És el principi de **mínim privilegi** aplicat al joc.

**Ordre de torns explícit.** Abans es calculava (qui va començar + nombre de torns). Ara és una llista que pot canviar: qui marxa en surt, qui entra s'afegeix al final de la ronda.

**Votació per consens.** Treure un absent requereix el vot de tots els altres actius. Si l'absent torna i fa qualsevol cosa, la votació s'anul·la. Qui és tret conserva els punts i la classificació, així que treure'l no li pren res.

**Concurrència optimista amb rebase** (per a la sincronització en línia, M4b). Si dues persones actuen alhora, el servidor accepta la primera. El mòbil de la segona rep la versió nova, hi torna a aplicar la seva acció i la publica. No es bloqueja mai res; el conflicte, poc freqüent, es resol quan passa.

**Lliçó 3 · ordre canònic.** La simulació va trobar que canviar les fitxes A, B, C o C, A, B donava bosses diferents: el resultat de remenar depenia de l'ordre en què les fitxes tornaven a la bossa. Al mòbil de qui jugava sortia una cosa i, en verificar-ho, al mòbil de qui ho rebia una altra. Ara les fitxes s'ordenen sempre abans d'aplicar l'acció. **Regla general: si un resultat ha de ser idèntic a tot arreu, cap detall arbitrari (ordre, hora, idioma) no hi pot influir.**

## 7. M3 · La interfície en un sol mòbil

**Dos tipus d'estat.** L'estat del joc (tauler, atrils, punts) el gestiona el motor. L'estat de la pantalla (fitxa seleccionada, fitxes posades sense confirmar, zoom) viu només al mòbil. Res no arriba a la partida fins que es prem «Juga» i el motor ho valida.

**Flux en una sola direcció.** Acció → canvia l'estat → la pantalla es redibuixa a partir de l'estat. La pantalla mai no es modifica a mà, i per això no hi pot haver incoherències.

**Components (Preact).** La pantalla es fa amb peces que reben dades i dibuixen: casella, fitxa, tauler, atril, marcador. Preact ocupa 4 KB; tota l'app, 19 KB comprimida, més el diccionari (250 KB).

**Compilar (Vite).** Converteix el TypeScript en fitxers optimitzats per al navegador, a la carpeta `app/`, que GitHub Pages publica.

**Prova automàtica al navegador (Playwright).** Un programa obre l'app en un Chrome amb mida de mòbil i hi juga: crea una partida de 3, busca la millor primera paraula amb el diccionari i la col·loca tocant fitxes i caselles, desfà, canvia fitxes, prova una jugada no vàlida, amplia el tauler, passa, recarrega la pàgina i comprova la pantalla final. Fa captures de cada pas i comprova que no hi ha cap error a la consola.

**Arrossegar (Pointer Events).** L'arrossegar clàssic del navegador (HTML5 *drag and drop*) no funciona amb el dit a l'iPhone; els Pointer Events sí, i tracten igual dit, ratolí i llapis. Si el dit es mou menys de 8 píxels és un toc; si es mou més, és arrossegar. La fitxa es dibuixa 44 píxels per sobre del dit perquè no quedi tapada, i es deixa on es veu la fitxa, no on és el dit.

**Validació en directe.** Cada vegada que es mou una fitxa, el motor revalida la jugada (mil·lisegons). En vermell, les fitxes de les paraules no vàlides, o totes si el problema és de posició; en verd, quan la jugada és vàlida.

**Lliçó 4 · un test mal plantejat sembla un error.** La prova de moure una fitxa dues files amunt no la movia: amb els 44 píxels d'elevació, el dit només es desplaçava 6 píxels, menys del llindar, i el programa ho interpretava (correctament) com un toc. Abans de corregir el codi, cal comprovar que la prova fa el que creus.

**Reordenar l'atril.** Arrossegant una fitxa dins l'atril es canvia de posició, i mentre el dit es mou es veu com quedarà. L'ordre es desa per fitxes (no per posicions) i només en aquest mòbil: quan robes fitxes noves, les que ja tenies conserven l'ordre i les noves van al final.

**Lliçó 5 · els límits de la pantalla.** La prova portava el dit 9 píxels fora de la pantalla, i allà el navegador no troba cap element. Un dit de veritat també pot arribar a la vora, així que ara les coordenades es retallen a la zona visible.

## 8. Paraules aprovades pels jugadors

**Proposta en lloc de jugada.** Si una paraula no és al diccionari però la posició és correcta, el jugador pot demanar que l'acceptin. Només ho decideix el jugador següent: amb connexió, des del seu mòbil; sense connexió, en escanejar el QR. Si la rebutja, no cal desfer res, perquè no s'havia aplicat. Si l'accepta, el motor l'aplica en aquella mateixa acció, i qualsevol mòbil pot comprovar-ho repetint-la.

**Simplificar treu estat.** La primera versió demanava el vot de tots amb connexió. Amb una sola persona que decideix desapareixen el quòrum i la llista de vots: la proposta només guarda qui juga i on posa les fitxes, el QR porta 9 bits menys i hi ha menys casos per provar.

**Diccionari viu.** Les paraules aprovades valen fins al final de la partida i es llisten a la pantalla final. És la manera d'anar completant el diccionari amb l'ús real.

## 9. Jugar sense instal·lar res

**Web i app són el mateix programa.** Una PWA és una pàgina web. «Instal·lar-la» afegeix una icona i l'obre a pantalla completa, però el codi és idèntic. Amb connexió, tocar l'enllaç de WhatsApp ja és entrar a la partida: es descarreguen 275 KB comprimits (app 23 KB + diccionari 252 KB) i el mòbil agafa seient.

**Què guarda el navegador.** El *service worker* és un petit programa que el navegador guarda amb la web i que la pot servir sense connexió. Les dades de la partida van a l'emmagatzematge local. Tot això funciona també sense instal·lar, però el navegador ho pot esborrar: Safari ho fa després de 7 dies fent servir Safari sense obrir aquella web. Les apps instal·lades a la pantalla d'inici en queden fora. Per això instal·lar només és útil per anar sense cobertura.

**Cada navegador és un món.** Safari, Chrome, l'app instal·lada i el navegador intern d'una app de missatgeria guarden les dades per separat. Si el mateix enllaç s'obre en dos llocs, per a l'app són dos mòbils diferents. La partida no es perd (és al servidor, o al QR de qualsevol altre mòbil), però aquell mòbil ha de tornar a dir quin jugador és, i un altre ho confirma.


## 10. M4 + M4b · Diversos mòbils: QR i en línia amb la mateixa lògica

**Un sol bloc.** Després de cada acció, el mòbil fa un paquet: l'estat sencer, les empremtes de les versions anteriors i, al QR, la clau de la partida. El QR i el servidor porten el mateix paquet (al servidor, xifrat). Així hi ha una sola manera de sincronitzar, i el que s'ha provat per a un canal val per a l'altre.

**Rebre una versió.** Si és la següent de la meva, el meu motor repeteix l'acció i ha de donar exactament el mateix (verificació per repetició). Si me'n falten de pel mig, miro si entre les empremtes que porta hi ha la de la meva versió: si hi és, «salto endavant». Si és més antiga, no faig res.

**Bifurcacions.** Dos mòbils poden fer versions diferents a partir de la mateixa (per exemple, algú desfà quan l'altre ja ha jugat). Guanya la branca més llarga; a igual llargada, una jugada guanya a un vot, i un vot a un desfer. Si encara empaten, en línia mana el servidor (qui hi ha arribat primer) i amb QR ho trieu vosaltres.

**Rebase.** Qui perd una bifurcació no perd la feina: el seu mòbil torna a aplicar les seves accions sobre la versió guanyadora, si encara són vàlides. S'atura al primer desfer o a la primera acció que ja no val, i avisa del que s'ha descartat. És el mateix concepte que fa servir git.

**Candau al servidor (concurrència optimista).** El mòbil diu «publico la versió 8 i parteixo de la 7». La regla de Firebase només ho accepta si la del servidor és la 7. Si algú ha publicat abans, la regla ho rebutja; el mòbil llegeix la nova, fa rebase i ho torna a provar. Ningú no bloqueja ningú i no es pot perdre res.

**Clau a l'enllaç.** El que hi ha darrere del `#` d'una adreça no s'envia mai al servidor web. D'aquesta clau surten l'adreça de la sala i la clau de xifratge (AES-GCM). Firebase només veu números de versió i dades xifrades; si algú les alterés, el xifratge ho detectaria.

**Escoltar sense llibreria.** Firebase permet escoltar una adreça amb *Server-Sent Events*: una connexió oberta per on el servidor envia els canvis. Si no funciona, l'app pregunta cada 4 segons. Sense la llibreria de Firebase, l'app ocupa ~60 KB menys i no necessita claus d'API.

**Seients.** Cada jugador té un seient al servidor amb el mateix candau. Qui obre l'enllaç agafa el primer lliure. Per recuperar un seient des d'un altre mòbil, un altre jugador ho ha de confirmar; amb QR, ensenyar el codi ja és donar el permís.

**Proves.** Una simulació de 150 partides amb tres mòbils, QR passats a l'atzar, desfers i abandonaments sempre acaba amb els tres mòbils iguals. Un servidor fals amb les mateixes regles que Firebase permet provar el candau, la desconnexió i la recuperació. Una prova al navegador fa jugar tres mòbils simulats: invitació per enllaç, jugades que arriben soles, paraula acceptada per l'altre, partida sense connexió amb QR i recuperació d'un seient.

**Lliçó 6 · l'estat que es veu ha d'avisar quan canvia.** La pantalla de convidar no mostrava «té mòbil ✓» perquè la sessió actualitzava els seients però no avisava la pantalla. Regla: qualsevol dada que es mostri, quan canvia, ha de provocar que es torni a dibuixar.

**Lliçó 7 · una acció, una versió.** Proposar i acceptar en el mateix mòbil feia dues accions d'un sol cop, i la rèplica ho rebutjava perquè la versió saltava de dos en dos. Cada acció ha de ser una versió pròpia: així qualsevol mòbil la pot verificar repetint-la.

**Jugada de prova (estat de pantalla que sobreviu).** Mentre un altre juga, pots posar fitxes de prova. No formen part de la partida: són «estat de pantalla» desat només al teu mòbil, per fitxes (no per posicions de l'atril). Quan arriba una versió nova, l'app torna a situar la prova sobre el tauler nou i treu només les fitxes que queden sota una lletra nova. Com que la prova es desa a cada moviment, tampoc es perd si recarregues la pàgina.
