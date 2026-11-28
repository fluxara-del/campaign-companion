# Kronike Devet Zvona — Campaign Companion

Privatna, self-hosted web-aplikacija za solo D&D 5e (2024) kampanju *Kronike Devet Zvona*: digitalni character sheet, dnevnik kampanje i integrirani AI Dungeon Master. Sučelje je na hrvatskom, izgled character sheeta slijedi vlasnikov referentni primjer (ADR-0008, vlastiti kod, bez tuđih asseta), a radi na mobitelu i desktopu.

> **Status: Faza 2 u pregledu (PR).** Postoje shema, domenski servis s batch idempotentnošću, event log, replay te probni uvoz postojeće kampanje u zasebnu bazu nad kopijom izvora. Nema UI-ja, HTTP ruta za pisanje ni AI-ja. Postojeće datoteke kampanje ostaju autoritativne dok se migracija izričito ne potvrdi.

## Tehnologija (zaključane verzije)

| Sloj | Verzija |
|---|---|
| Node.js | 24 LTS (`.nvmrc`, `engines`) |
| Next.js / React | 16.4.6 / 19.3.1 (App Router) |
| TypeScript | 6.0.3 (typescript-eslint još ne podržava 7.x) |
| Tailwind CSS / shadcn/ui | 4.3.5 / `components.json` (komponente se dodaju po potrebi) |
| Prisma ORM | 7.10.1 (`prisma-client` generator, `@prisma/adapter-better-sqlite3`) |
| SQLite driver | better-sqlite3 12.11.1 (SQLite 3.53) |
| Testovi | Vitest 5.1.1 (projekti `unit` i `db`) |
| ESLint | 9.39.5 + eslint-config-next 16.4.6 |

Obrazloženje: [ADR-0001](docs/adr/0001-tehnoloski-stog.md).

## Lokalni razvoj

```powershell
npm ci
Copy-Item .env.example .env
npm run db:migrate:deploy
npm run dev
```

Aplikacija je na <http://localhost:3000>, health check na `/api/health`.

**Lokalni način bez prijave (`KDZ_AUTH_MODE=local-owner`, dok se ne odluči O5).** Po zadanom je isključen (u `.env.example` zakomentiran); za lokalni rad odkomentiraj ga u svom `.env`. `npm run dev` i `npm start` pokreću Next.js kroz `scripts/app/launch.mjs`, koji ga veže na `127.0.0.1` (ili `KDZ_LISTEN_HOST`) i odbija pokretanje ako je uz `local-owner` zadana ne-loopback adresa. API u tom načinu radi samo kad je bind potvrđen; `next start` pokrenut izravno (bez pokretača) ili slika s `HOSTNAME=0.0.0.0` dobiva 503. Provjera Host zaglavlja u API-ju samo je dodatna obrana i **nije sigurnosna granica**. `KDZ_LISTEN_HOST` se ne stavlja u `.env`: postavlja ga pokretač.

| Naredba | Namjena |
|---|---|
| `npm run typecheck` / `lint` | TypeScript i ESLint |
| `npm test` (`test:unit`, `test:db`) | Testovi; DB testovi rade isključivo u privremenim direktorijima |
| `npm run db:migrate:dev` | Nova migracija (samo razvoj) |
| `npm run db:migrate:check` | Provjera migracija (destruktivne naredbe, imena, lock) |
| `npm run db:backup -- --out ./backups` | Konzistentna kopija + integritet + manifest |
| `npm run db:verify -- --backup <datoteka>` | Provjera kopije (hash + integrity_check) |
| `npm run db:restore -- --backup <datoteka> --confirm` | Restore (aplikacija zaustavljena; stara baza se premješta, ne briše) |
| `npm run dev:seed -- --db ./data/dev.db` | Sintetička demo kampanja za lokalni razvoj (uz `KDZ_AUTH_MODE=local-owner` u `.env`) |
| `npm run test:e2e` | Playwright e2e (desktop i 390 px) nad privremenom bazom |
| `npm run import:trial -- --source <kampanja>` | Probni uvoz u zasebnu bazu nad kopijom izvora (`import-sandbox/`, izvan Gita); pokretati dok se kampanja ne mijenja |
| `npm run export -- --campaign <id> --out <dir> [--audience player/dm]` | Verzionirani izvoz (generacija s manifestom i SHA-256, `CURRENT.<publika>.json`); `--verify` provjerava objavljenu generaciju. Samo čita bazu; izvoze ne stavljati u Git (`/exports/` je ignoriran) |

## Način rada

Razvoj ide kroz feature grane i pull requestove prema `main`; CI mora proći prije spajanja. Detalji: [CONTRIBUTING.md](CONTRIBUTING.md).

## Dokumentacija

- Planiranje: [analiza](docs/planning/01-analiza-ddb.md), [specifikacija](docs/planning/02-specifikacija.md), [razvojni plan](docs/planning/03-razvojni-plan.md), [nedosljednosti i otvorene odluke](docs/planning/NEDOSLJEDNOSTI.md)
- Odluke: [docs/adr](docs/adr/)
- Izvještaji: [Faza 0](docs/reports/faza-0-izvjestaj.md), [Faza 1](docs/reports/faza-1-izvjestaj.md), [Faza 2](docs/reports/faza-2-izvjestaj.md), [Faza 3a](docs/reports/faza-3a-izvjestaj.md), [Faza 3b](docs/reports/faza-3b-izvjestaj.md)
- Pravila za agente: [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md)
- Operacije: [CI/CD](docs/operations/ci-cd.md), [ZimaOS deployment](docs/operations/zimaos-deployment.md), [SQLite sigurnost](docs/operations/sqlite-sigurnost.md), [rollback i restore](docs/operations/rollback-i-restore.md), [tajne i konfiguracija](docs/operations/tajne-i-konfiguracija.md), [multi-agent workflow](docs/operations/multi-agent-workflow.md)

## Što nikad ne ulazi u repozitorij

`.env` datoteke i API ključevi, SQLite baze i WAL/SHM datoteke, privatni podaci kampanje (`dm_private/`, kopije za uvoz), sigurnosne kopije, sesijski tokeni i vjerodajnice te snimke ili asseti tuđih proizvoda. `.gitignore` to pokriva, a PR predložak traži provjeru.

## Licenca

Privatni projekt, sva prava pridržana. Sadržaj pravila uključuje se samo iz originalnih ili provjereno dopuštenih izvora.
