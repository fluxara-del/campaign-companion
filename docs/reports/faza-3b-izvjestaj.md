# Izvještaj Faze 3b — sučelje character sheeta

Datum: 25. 11. 2026. Pripremio: Claude Code. Issue #15. Grana `feature/faza-3b-sucelje-lika` nadograđuje se na 3a (PR #16, još nespojen); PR 3b uspoređuje se s granom 3a. Status: **čeka review i odobrenje vlasnika.** Deploy nije aktiviran; podaci kampanje nisu mijenjani.

## Isporučeno

- **HTTP sloj** (`src/app/api/campaigns/…`): `GET /api/campaigns`, `GET …/characters/:id/sheet`, `POST …/batches`, `GET …/batches/:batchId`. Sve mutacije idu isključivo kroz `executeBatch`.
- **Pristup dok O5 nije odlučen** (`src/server/app/access.ts`): `KDZ_AUTH_MODE=local-owner` — samo loopback host, jedan vlasnik; bez te postavke (npr. produkcijska slika) API vraća 503. Mutacije traže isti origin (CSRF) i JSON, tijelo do 256 KiB, `campaignId` u tijelu mora odgovarati adresi. `npm run dev` sluša samo na `127.0.0.1`.
- **Sučelje** (`src/components/sheet/*`, `/kampanja/:id/lik/:characterId`): kompaktno zaglavlje (HP, koncentracija, verzija), status upisa u live regionu (Provjera → Spremanje → „Spremljeno, verzija N” / Konflikt / Odbijeno / Veza prekinuta s gumbom „Ponovi isti zahtjev” koji šalje isti `batchId`), kartice Pregled, Borba, Oprema, Magija, Sposobnosti, Bilješke; objašnjenja izvedenih vrijednosti (otvaranje klikom/tipkovnicom, bez hovera); dijalozi za trajnu promjenu (razlog), bacanje (izričit izbor troška), podatke čarolije i pregled odmora; donja navigacija Igra/Lik/Dnevnik/Više na mobitelu (Igra i Dnevnik označeni „uskoro”).
- **Vizualni sustav:** vlastita paleta (pergament/tinta/bronca/zvono), serifni naslovi, bez dekorativnih okvira i bez tuđih asseta; mete dodira ≥ 44 px; vidljiv fokus.
- **Demo podaci:** `npm run dev:seed -- --db ./data/dev.db` (sintetička kampanja, bez stvarnih podataka).

## E2E (Playwright) — 13 scenarija × desktop 1280 px i 390 px = 26 testova

| Scenarij iz plana | Test |
|---|---|
| Promjena ability score-a s preračunom | „promjena atributa preračunava …” (CHA 14→16: mod, save, spell DC) |
| Šteta kroz temp HP; liječenje s granicom | „šteta prvo troši privremeni HP; liječenje ima granicu” |
| Nevaljani unos | „nevaljani unos se odbija bez upisa” |
| Potrošnja zadnjeg resursa | „potrošnja zadnjeg resursa” |
| Oprema iz spremnika | „oprema iz spremnika: izvadi pa opremi” |
| Transfer predmeta | „transfer predmeta NPC-u (spremnik nosi sadržaj)” |
| Priprema čarolije | „priprema čarolije” |
| Cast s odabranim troškom; concentration save | „bacanje s odabranim troškom i concentration save” |
| Pregled i potvrda odmora | „pregled i potvrda dugog odmora” |
| Ulazak u karticu/filter ne mutira | „ulazak u kartice … ne šalju nijednu promjenu” (nijedan ne-GET zahtjev) |
| Vidljivo stanje spremanja i konflikti | svi testovi čekaju „Spremljeno, verzija N”; „konflikt: zastarjela verzija …” |
| Tipkovnica | „tipkovnica: kartica, unos i radnja bez miša” |
| 390 px, bez horizontalnog skrola | „raspored: bez horizontalnog skrola; na mobitelu donja navigacija” |

Svaki test radi nad vlastitom sintetičkom kampanjom u svježoj privremenoj bazi (`scripts/e2e/serve.ts`), na `127.0.0.1`. Lokalno: 26/26. CI: novi job „E2E (Playwright, desktop i 390 px)”. Ukupno unit/DB: 158 testova (uključujući 3 za pristup API-ju).

## Što ne dokazuje

Stvarne iOS/Android uređaje i Safari (390 px je Chromium viewport), čitač zaslona i 200 % zoom (nije automatizirano), autentifikaciju i mrežni pristup (O5), Igru i Dnevnik (Faze 4–6).
