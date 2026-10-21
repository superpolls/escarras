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
