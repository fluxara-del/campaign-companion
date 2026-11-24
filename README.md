# Kronike Devet Zvona — Campaign Companion

Privatna, self-hosted web-aplikacija za solo D&D 5e (2024) kampanju *Kronike Devet Zvona*: digitalni character sheet, dnevnik kampanje i integrirani AI Dungeon Master. Sučelje je na hrvatskom, dizajn je originalan, a radi na mobitelu i desktopu.

> **Status: Faza 0 (temelji).** Postoje kostur aplikacije, CI, sigurnosni alati za SQLite i pripremljen (neaktivan) deploy na ZimaOS. Funkcionalnosti kampanje dolaze od Faze 1, nakon odobrenja. Postojeće datoteke kampanje ostaju autoritativne dok se migracija izričito ne potvrdi.

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

| Naredba | Namjena |
|---|---|
| `npm run typecheck` / `lint` | TypeScript i ESLint |
| `npm test` (`test:unit`, `test:db`) | Testovi; DB testovi rade isključivo u privremenim direktorijima |
| `npm run db:migrate:dev` | Nova migracija (samo razvoj) |
| `npm run db:migrate:check` | Provjera migracija (destruktivne naredbe, imena, lock) |
| `npm run db:backup -- --out ./backups` | Konzistentna kopija + integritet + manifest |
| `npm run db:verify -- --backup <datoteka>` | Provjera kopije (hash + integrity_check) |
| `npm run db:restore -- --backup <datoteka> --confirm` | Restore (aplikacija zaustavljena; stara baza se premješta, ne briše) |

## Način rada

Razvoj ide kroz feature grane i pull requestove prema `main`; CI mora proći prije spajanja. Detalji: [CONTRIBUTING.md](CONTRIBUTING.md).

## Dokumentacija

- Planiranje: [analiza](docs/planning/01-analiza-ddb.md), [specifikacija](docs/planning/02-specifikacija.md), [razvojni plan](docs/planning/03-razvojni-plan.md), [nedosljednosti i otvorene odluke](docs/planning/NEDOSLJEDNOSTI.md)
- Odluke: [docs/adr](docs/adr/)
- Pravila za agente: [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md)
- Operacije: [CI/CD](docs/operations/ci-cd.md), [ZimaOS deployment](docs/operations/zimaos-deployment.md), [SQLite sigurnost](docs/operations/sqlite-sigurnost.md), [rollback i restore](docs/operations/rollback-i-restore.md), [tajne i konfiguracija](docs/operations/tajne-i-konfiguracija.md), [multi-agent workflow](docs/operations/multi-agent-workflow.md)

## Što nikad ne ulazi u repozitorij

`.env` datoteke i API ključevi, SQLite baze i WAL/SHM datoteke, privatni podaci kampanje (`dm_private/`, kopije za uvoz), sigurnosne kopije, sesijski tokeni i vjerodajnice te snimke ili asseti tuđih proizvoda. `.gitignore` to pokriva, a PR predložak traži provjeru.

## Licenca

Privatni projekt, sva prava pridržana. Sadržaj pravila uključuje se samo iz originalnih ili provjereno dopuštenih izvora.
