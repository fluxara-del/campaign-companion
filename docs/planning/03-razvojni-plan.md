# Kronike Devet Zvona — razvojni plan

Datum: 24. studenoga 2026. Status: plan, bez implementacije ili instaliranja ovisnosti.

Plan pretvara [specifikaciju](02-specifikacija.md) u provjerljive faze. Faze su poredane po ovisnostima; procjena kalendarskog trajanja dolazi tek nakon odabira opsega pravila i AI providera. D&D Beyond analiza daje istraživački kontekst, a ne zahtjev za vjernom reprodukcijom.

## Faza 0 — odluke i ugovori

Pripremiti odluke o lokalnom deploymentu, verziji Next.js/Prisma/Node.js i SQLite adaptera, podržanom 2024 ruleset opsegu, AI provideru, ručnom bacanju kockica i granici između public naratora i DM privatnog konteksta. Provjeriti aktualne službene dokumentacije; ne miješati Prisma API generacije. Za lokalnu bazu koristiti trajni volumen i jedan app server. [Prisma: SQLite](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite), [Next.js: Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)

Izlaz su kratki architecture decision records, popis sadržaja s podrijetlom, tipizirani command/event ugovori i popis namjerno nepodržanih pravila. Cilj je razriješiti dvojbe prije scaffolda. Gate: razvojni ugovor izričito čuva player agency, ručna bacanja, lokalni autoritet i nepoznate vrijednosti.

## Faza 1 — podaci i povjerenje u zapis

Izraditi shemu, migracije, domenski validator, transakcijski servis, event log, receipt zapis, pravila verzioniranja i pristup kampanji. Najprije implementirati minimalne sintetičke naredbe i restore postupak. AI i puno UI sučelje još nisu potrebni.

Testovi moraju dokazati atomarnost, deduplikaciju, konflikt verzije, ponašanje pri zauzetoj SQLite bazi i prekid poslije commita. Usporediti snapshot s replayom od baseline-a. Provjeriti strane ključeve i nemogućnost povezivanja entiteta različitih kampanja. Transakciju držati kratkom jer SQLite serializira pisanja. [SQLite: Isolation](https://www.sqlite.org/isolation.html)

Gate: niti jedna potvrđena promjena ne postoji bez događaja i receipt-a; niti jedan neuspjeli batch nije djelomično primijenjen.

## Faza 2 — uvoz postojeće kampanje

Napraviti read-only importer preview nad kopijom postojećih izvora. Očuvati ID-jeve, izvorne hashove, null vrijednosti, privatnost, osobni/grupni novac i ownership/custody. Detektirati nesklad strukturiranih polja i povijesnog Markdowna. Zadržati legacy događaje kao dokaze, bez pretvaranja narativnog teksta u izmišljene precizne delta događaje.

Pripremiti probni uvoz u odvojenu bazu i usporedni izvještaj. Konkretni regresijski slučajevi zatečenih datoteka: `PC-001`, spell slots 0/2, freeDivineSmite 0/1, Heroic Inspiration nepoznat, potvrđen odmor ne postoji, zaseban osobni i namjenski grupni novac. Brojeve ponovo provjeriti prije stvarnog cutovera jer kampanja može napredovati.

Gate: uvoz je deterministički, ne mijenja izvore i može se odbaciti; korisnik dobiva konkretan izvještaj prije prihvaćanja prelaska na novu bazu. Stare datoteke ostaju autoritet do tog trenutka.

## Faza 3 — originalni character sheet

Implementirati navigaciju i prikaze: statistike, HP, akcije, oprema, čarolije, features/traits, resursi, uvjeti i odmor. Svi kontroleri pozivaju isti domenski servis. Objasniti izvedene vrijednosti i overrideove; izdvojiti trajne promjene lika od potrošnje tijekom igre. Oblikovati vlastiti vizualni sustav, bez preuzimanja referentnih stilova ili asseta.

End-to-end scenariji: promjena ability score-a s preračunom podržanih izvedenih vrijednosti; šteta kroz temp HP; liječenje s granicom; nevaljani unos; potrošnja zadnjeg resursa; oprema iz spremnika; transfer predmeta; priprema čarolije; cast s odabranim troškom; concentration save zahtjev; pregled i potvrda odmora. Provjeriti da ni običan ulazak u karticu ni promjena filtra ne mutiraju stanje.

Gate: svi scenariji rade na desktopu, 390 px mobilnom viewportu i tipkovnicom, uz vidljivo stanje spremanja i konflikte. Nije dovoljna snimka izgleda.

## Faza 4 — dnevnik i kontinuitet

Implementirati determinističku journal projekciju, osobne bilješke, session prikaz, pretragu dopuštenog znanja, izvore tvrdnji i verzionirani handoff/export. Dodatni AI sažeci dolaze kasnije; osnovni dnevnik mora raditi bez AI providera.

Testirati filtriranje tajni na serveru, razliku glasine i kanona, referenciranje izvornog događaja, ispravku bez brisanja povijesti i ponovno generiranje projekcije. Izvoz mora pokazati verziju i provjerene hashove cijele generacije. Prekid exporta ne smije proizvesti navodno dovršen miješani skup datoteka.

Gate: aplikacija može pouzdano odigrati i spremiti sesiju s ručnim DM unosom čak i kada AI nije dostupan.

## Faza 5 — AI DM bez automatskih zapisa

Dodati provider adapter, sastavljanje ograničenog konteksta, turn state machine, streaming nacrta, structured output validaciju, roll zahtjeve i pregled predložene promjene. Prva validacijska etapa pokreće AI u načinu prijedloga: stvarne se promjene uspoređuju s očekivanim rezultatom prije omogućivanja auto-apply politike.

Evaluacijski skup mora uključiti uobičajenu odluku igrača, dvosmislenu poruku, nepoznat roll, prompt injection u pismu, pokušaj upravljanja likom, ispravak kanona, nedostajući izvor pravila, zastarjeli snapshot, nepovezani character ID, neispravan JSON, timeout providera i DM tajnu. Ocjenjivati ne samo narativnu kvalitetu nego stopu nevaljanih i nepravilno automatski prihvaćenih prijedloga.

Gate: nikad se ne izvršava nepotpun ili nevaljan prijedlog; neriješeni turnovi imaju razumljivo stanje i mogu se nastaviti bez dupliranja.

## Faza 6 — automatsko ažuriranje tijekom igranja

Omogućiti auto-apply samo za validirane naredbe s jasnim intentom, podržanim pravilima i potvrđenim preduvjetima. Spojiti atomarni zapis, minimalni journal, SSE i rekoncilijaciju klijenta. Dodati oporavak AiTurn zapisa nakon restarta i upit postojećeg receipt-a prije ponavljanja.

Puni ključni scenarij: igrač odabere radnju → DM traži rezultat → igrač ga unosi → validator razrješava posljedicu → transakcija upisuje stanje i događaje → sheet i journal se osvježavaju → reload potvrđuje isto stanje → ponovljeni zahtjev nema dodatni učinak. Drugi scenarij paralelno ubacuje ručnu izmjenu radi provjere 409 konflikta i novog AI prijedloga.

Gate: nijedna mehanička promjena ne ovisi o tome je li SSE poruka stigla; potvrđena naracija odgovara receipt-u, a player odluke ostaju igraču.

## Faza 7 — pilot, sigurnosne kopije i isporuka

Provesti jednu sintetičku i jednu dogovorenu pilot sesiju, pregledati pogreške, testirati obnovu baze u odvojenom direktoriju, import/export roundtrip i pristup s mobitela. Za mrežni pristup provjeriti autentifikaciju, origin/CSRF, scope kampanje i absence DM sadržaja u player odgovorima. Proxy mora propuštati streaming. [Next.js: Self-hosting](https://nextjs.org/docs/app/guides/self-hosting)

Backup automatizirati tek nakon provjerenog restore postupka. SQLite Online Backup API ili ekvivalentan konzistentni snapshot prikladniji je od kopiranja samo aktivne `.db` datoteke. [SQLite: Online Backup API](https://www.sqlite.org/backup.html)

Gate: sva mjerila prihvata iz specifikacije prolaze; poznata ograničenja ruleseta su vidljiva; postoji postupak rollbacka bez gubitka potvrđenih događaja. Tek tada aplikaciju koristiti kao autoritativni alat kampanje.

## Testna matrica za implementaciju

| Rizik | Provjera | Očekivani dokaz |
|---|---|---|
| Dvostruki trošak | 2 ista batcha (isti `batchId`), dvostruki klik, retry nakon timeouta | Jedan receipt i jedna promjena; isti rezultat odgovora. |
| Različit payload istog ID-ja | Namjerno promijenjen iznos ili redoslijed pod istim `batchId` | Konflikt bez dodatnog upisa. |
| Gubitak promjene | Manual i AI s istom baseVersion | Jedan prihvaćen batch, drugi 409. |
| Djelomično spremanje | Izazvati pogrešku usred višestrukog zapisa | Snapshot, events i receipt zajedno rollback. |
| Prekid pri dostavi | Commit uspije, HTTP/SSE prekid | Receipt/replay oporavi točno jednom. |
| Pogrešan odmor | Jutro, session switch, rest cancel | Resursi ostaju isti dok CompleteRest nije valjan. |
| Nepoznato postaje nula | Import/export null resursa i mase | Oznaka nepoznatog ostaje. |
| Prepisivanje kanona | AI predloži novu prošlost | Zahtjev za odluku; nema tihe mutacije. |
| Otkrivanje tajne | Player API, RSC, SSE, search, export | Privatni tekst i metapodaci nisu u payloadu. |
| Neodrživ snapshot | Replay iz baseline-a | Isti hash kanonskog snapshot-a. |
| Nevaljana kopija | Restore na zasebnoj lokaciji | Integritet, verzija, posljednji događaj i resursi jednaki. |
| Mobilni gubitak stanja | Back, refresh, background, keyboard open | Očuvan nacrt ili jasna obavijest; bez nevidljivog troška. |

## Redoslijed prioriteta

**P0 — nužno prije stvarne igre:** atomarnost, idempotency, verzije, authority cutover, pristup kampanji, HP/resursi/inventory, manual rolls, journal, restore i sprječavanje curenja tajni.

**P1 — puni MVP:** spells/features, podržana pravila odmora, AI prijedlozi i auto-apply, SSE replay, mobile UX, verzionirani sažeci i handoff.

**P2 — nakon stabilnog pilota:** detaljniji encounter tracker, opcionalni server-generated dice s vidljivim podrijetlom, napredna pretraga, više likova, složenije ruleset proširenje i ograničeni offline nacrti. Svaki ima vlastite kriterije prihvata; nisu prešutni dio MVP-a.

## Otvorene odluke za početak razvoja

- Lokalni desktop-only način ili mobitel preko privatne mreže; potonji povećava opseg autentifikacije i deploymenta.
- AI provider i granice cijene, timeouta, konteksta i pohrane podataka.
- Točan početni katalog dopuštenog sadržaja i podržanih 2024 pravila; ne uvoziti vlasnički D&D Beyond sadržaj.
- Hoće li DM tajne u MVP-u postojati u AI kontekstu ili samo u zasebnoj ručno vođenoj pohrani.
- Opseg borbenog trackera: samo osobni resursi ili i potezi protivnika; ne pretpostavljati puni VTT.

Ove odluke ne sprječavaju sadašnju analizu i plan. Razrješavaju se nad konkretnim ugovorima u fazi 0, prije implementacije.
