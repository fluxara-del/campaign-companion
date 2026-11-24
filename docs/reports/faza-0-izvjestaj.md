# Izvještaj Faze 0 — za neovisni supervisor review

Datum: 24. 11. 2026. Pripremio: Claude Code (Lead Developer). Status: **čeka review i odobrenje vlasnika.** PR #6 nije spojen, Faza 1 nije započeta, produkcijski deploy nije aktiviran.

Ovaj dokument je samostalan: supervisor ga može pregledati bez pristupa razgovoru. Svaka tvrdnja ima izvor (datoteku, PR, workflow run) ili je označena kao **neprovjereno**.

## 1. Opseg i izvori

| Izvor | Uloga |
|---|---|
| `docs/planning/02-specifikacija.md` | Glavni funkcionalni i tehnički zahtjevi |
| `docs/planning/03-razvojni-plan.md` | Redoslijed faza i kriteriji prihvata (Faza 0 = odluke i ugovori) |
| `docs/planning/01-analiza-ddb.md` | UX referenca, ne predložak |
| Brief vlasnika (24. 11.) | Faza 0 dodatno: repo, CI, deploy strategija, SQLite politika, rollback, multi-agent workflow |

Planski dokumenti u repozitoriju byte-identični su kopijama u `Kronike-Devet-Zvona/docs/campaign-companion/` (SHA-256 provjeren).

## 2. Stanje repozitorija

- Repozitorij: `fluxara-del/campaign-companion` (privatni; razmak iz traženog imena „Campaign companion” GitHub ne dopušta).
- Grane: `main` (početni commit `b5cd192`), `fix/faza-0-docker-ci` (PR #6, otvoren, nije spojen).
- Issue #5 prati Fazu 0. Dependabot PR-ovi #1–#4 (major nadogradnje) su otvoreni; preporuka je zatvoriti ih (vidi §8).
- Postavke: samo *squash merge*, auto-merge isključen, brisanje grane nakon mergea.

```
.github/            CI, deploy (neaktivan), PR pravila, Dependabot, PR/issue predlošci
deploy/zimaos/      compose.yaml, deploy.sh, deploy-gate.sh, app.env.example
docs/adr/           0001 stog · 0002 deploy · 0003 razvojni ugovor · 0004 naredbe/događaji · 0005 sadržaj/pravila
docs/operations/    ci-cd, zimaos-deployment, sqlite-sigurnost, rollback-i-restore, tajne-i-konfiguracija, multi-agent-workflow
docs/planning/      tri planska dokumenta + NEDOSLJEDNOSTI.md (13 nedosljednosti, 7 otvorenih odluka)
docs/reports/       ovaj izvještaj
prisma/             schema.prisma (samo AppMeta) + migracija 20261124221854_init_app_meta
scripts/db/         backup, verify, restore, check-migrations
src/app/            početna stranica (hr), /api/health
src/server/db/      sqlite-safety.ts
tests/unit, tests/db
CLAUDE.md, AGENTS.md, CONTRIBUTING.md, README.md, Dockerfile, .env.example
```

Zaključane verzije i obrazloženja: ADR-0001 (Node 24, Next 16.4.6, React 19.3.1, TS 6.0.3, ESLint 9.39.5, Prisma 7.10.1, better-sqlite3 12.11.1, Tailwind 4.3.5, Vitest 5.1.1).

## 3. GitHub Actions

| Workflow | Okidač | Rezultat (zadnja provjera) |
|---|---|---|
| CI — Provjere | PR, push na `main` | `main` @ `b5cd192`: **prošlo**; PR #6: **prošlo** |
| CI — Docker image i smoke test | nakon Provjera | `main` @ `b5cd192`: **palo** (nedostajao `public/`); PR #6 @ `22f1f25` (run 45504564265, uklj. read-only zastavice i restore probu): **prošlo** |
| PR pravila | PR | PR #6: **prošlo**; Dependabot PR-ovi: palo prije iznimke iz PR #6 |
| Deploy (ZimaOS) | `workflow_run` nakon CI-a na `main` | run 45501832880: gate „Provjera dopuštenja” prošao, **build i deploy preskočeni** (`DEPLOY_ENABLED` nije postavljen) |

Što CI provjerava: `npm ci`, `tsc --noEmit`, ESLint (0 upozorenja), unit testovi, testovi baze, `check-migrations` (destruktivne naredbe, imena, lock), `prisma migrate diff --exit-code` (shema = migracije), `next build`, `npm audit --omit=dev --audit-level=high`. Docker smoke test: build slike → `migrate deploy` na privremenom volumenu → procjena migracija → backup → provjera kopije → restore u zasebnu probnu datoteku → provjera → pokretanje aplikacije s `--read-only` → `/api/health`.

Sigurnost workflowa: `permissions` minimalne (`contents: read`; `packages: write` samo u build jobu deploya; top-level `{}` u deployu), `persist-credentials: false`, sve akcije pinirane na commit SHA, `concurrency: production-deploy` bez prekidanja, deploy samo iz uspješnog CI-a pokrenutog **pushom** na `main` u ovom repozitoriju, tajne samo kroz `env`.

**Iskrena ograničenja:**
- „Testovi domenskih pravila” trenutačno ne postoje jer domenski model nije dio Faze 0. CI korak `test:db` pokriva sigurnost baze; domenski testovi ulaze s Fazom 1.
- Docker build i smoke test izvršavaju se samo u CI-u (lokalno nema Dockera).

## 4. Sigurnost SQLite podataka

| Zahtjev (brief §7) | Implementacija | Dokaz |
|---|---|---|
| Baza na trajnom lokalnom volumenu, izvan imagea i Gita | `/DATA/AppData/campaign-companion/data` → `/data`; `.gitignore` i `.dockerignore` isključuju `*.db*` | `deploy/zimaos/compose.yaml`, `.gitignore` |
| 1. Provjera stanja baze | `integrity_check` + `foreign_key_check` | `sqlite-safety.ts: checkIntegrity` |
| 2. Konzistentna kopija | SQLite Online Backup API (uključuje WAL), manifest sa SHA-256, nikad prepisivanje | test „kopija uključuje podatke iz WAL-a” |
| 3. Integritet kopije | hash iz manifesta + `integrity_check` | test „otkriva izmijenjenu kopiju” |
| 4. Procjena kompatibilnosti | pending, nepoznate (novije) i neuspjele migracije, redoslijed, neodobrene destruktivne naredbe | 3 testa u `tests/db/backup-restore.test.ts` |
| 5. Migracija samo ako je sigurna | `deploy.sh` prekida prije ikakve promjene ako `check-migrations --db` ne prođe | `deploy/zimaos/deploy.sh` korak 1 |
| Bez destruktivnih reset naredbi | samo `prisma migrate deploy`; `reset`/`db push` nigdje u skriptama | grep repozitorija |
| Neuspjeh → stop i očuvanje podataka; bez rollbacka na nekompatibilnu verziju | `compatible_with_db` prije svakog automatskog vraćanja | `deploy.sh` koraci 4–5 |
| Zaseban, testiran restore | `restore.ts`: provjera → staging → atomsko preimenovanje; stara baza premještena, ne obrisana | test „restore vraća stanje i čuva prethodnu bazu”, CI restore probe |
| Testovi nikad nad produkcijom | `tests/setup.ts` briše `DATABASE_URL`; DB testovi u `os.tmpdir()`; CI nema tajni ni mrežni put do servera | `tests/setup.ts`, `assertTestDatabasePath` |

Postojeća kampanja: SHA-256 svih 44 datoteka u `E:\DnD\Kronike-Devet-Zvona` identičan prije i poslije rada; `dm_private/` nije otvaran; nije napravljena ni kopija za uvoz (to je Faza 2).

## 5. ZimaOS deployment konfiguracija

Arhitektura (ADR-0002, `docs/operations/zimaos-deployment.md`): slika u privatnom GHCR-u, deploy po digestu; GitHub Actions ulazi u tailnet kao efemerni čvor (`tag:ci-deploy`, OAuth); OpenSSH na ZimaOS-u (samo Tailscale sučelje) s ključem ograničenim na forced command `deploy-gate.sh` (`restrict`), koji dopušta samo `deploy|rollback <ghcr…@sha256:…>` i `status`; aplikacija na `127.0.0.1:3000` iza `tailscale serve`. Nema javnih portova, Funnela ni self-hosted runnera.

Stanje aktivacije: nijedna tajna ni varijabla nije postavljena (`gh secret list`, `gh variable list` prazni); environment `production` postoji i ograničen je na granu `main`; *required reviewers* odbijen (HTTP 422, plan ne podržava).

**Neprovjereno na stvarnom serveru:** `bash`/`flock`/`curl`/`docker compose` na ZimaOS-u, vezanje SSH-a samo na Tailscale, CPU arhitektura (pretpostavljeno amd64), vlasništvo direktorija (uid 1000). To je dio pilota.

## 6. Codex Code Review — stanje

**Povezan i radi** (provjereno 24. 11. 2026.): vlasnik je uključio ChatGPT Codex Connector; na komentar `@codex review` Codex je pregledao commit `41c616d` i prijavio jedan nalaz:

| Ozbiljnost | Datoteka | Nalaz | Ishod |
|---|---|---|---|
| P2 / važno | `.github/workflows/pr-policy.yml:16` | Iznimka za Dependabot koristila je `github.actor`; kad vlasnik uredi Dependabot PR, provjera bi ga pogrešno odbila. | Prihvaćeno, ispravljeno (`github.event.pull_request.user.login`), odgovor u PR-u. |

Automatski review novih PR-ova ovisi o Codex postavkama vlasnika; ručni okidač `@codex review` radi.

## 7. Samoprovjera (nalazi Lead Developera)

Ispravljeno u PR #6: Docker build (nedostajao `public/`); smoke test sada koristi iste zastavice kao produkcija (`--read-only`, uid 1000, bez mreže i capabilities) i probu restorea; `HOME=/tmp` za jednokratne kontejnere; Dependabot ne predlaže major nadogradnje zaključanih paketa.

Poznata ograničenja i rizici koje supervisor treba procijeniti:
1. **GitHub Free:** nema zaštite grane ni obveznih provjera ni odobravatelja za environment (HTTP 403/422). Zaštita je trenutačno proceduralna. Opcije: GitHub Pro ili prihvaćanje rizika.
2. **Odobrenje vlasnika:** PR-ove otvara vlasnikov račun (Claude radi kroz `gh` vlasnika), pa GitHub ne dopušta formalni approve. Odobrenje = merge koji radi isključivo vlasnik. Alternativa: zaseban bot račun.
3. **Korisnik `kdz-deploy` u grupi `docker`** je efektivno root; ublaženo forced commandom, Tailscale ACL-om i zasebnim ključem.
4. **Autentifikacija aplikacije** ne postoji; mora postojati prije korištenja s mobitela kroz tailnet (NEDOSLJEDNOSTI N2/O5).
5. **Deploy ima kratak prekid** (aplikacija se zaustavlja radi konzistentne kopije i jednog pisca) — prihvatljivo za solo kampanju.
6. `findDestructiveStatements` je heuristika nad tekstom SQL-a; ne zamjenjuje ljudski pregled migracija.
7. Prisma `RedefineTables` za SQLite uvijek traži marker; to je namjerno strogo.

## 8. Otvorene odluke (vlasnik)

O1 opseg pravila i katalog (prijedlog: SRD 5.2 + korisnički sadržaj; ADR-0005) · O2 AI provider, model, budžet · O3 DM tajne u AI kontekstu (prijedlog: ne) · O4 opseg borbe · O5 autentifikacija · O6 kopija izvan ZimaOS-a · O7 CPU arhitektura · GitHub Pro da/ne · zatvaranje Dependabot PR-ova #1–#4 · prihvaćanje ADR-0003 do ADR-0005.

## 9. Pitanja za supervisora

1. Pokriva li Faza 0 gate iz plana („razvojni ugovor izričito čuva player agency, ručna bacanja, lokalni autoritet i nepoznate vrijednosti”) — ADR-0003?
2. Je li redoslijed u `deploy.sh` (kompatibilnost → stop → integritet → kopija → provjera → migracija → health) dovoljan, i je li odluka da se ne vraća automatski na nekompatibilnu verziju ispravno provedena?
3. Je li pristup GitHub Actions → Tailscale → forced-command SSH prihvatljiv bez zasebne sigurnosne procjene, ili treba pull model?
4. Jesu li ugovori u ADR-0004 dovoljno strogi za Fazu 1 (idempotentnost, 409, actor iz sesije)?
5. Postoji li nedosljednost u `NEDOSLJEDNOSTI.md` čije je predloženo rješenje u sukobu sa specifikacijom?

## 10. Kako provjeriti

```powershell
git clone https://github.com/fluxara-del/campaign-companion; cd campaign-companion; git checkout fix/faza-0-docker-ci
npm ci; npm run typecheck; npm run lint; npm test; npm run db:migrate:check; npm run build; npm run audit:deps
```

PR #6: https://github.com/fluxara-del/campaign-companion/pull/6 · Issue #5 · Actions: https://github.com/fluxara-del/campaign-companion/actions
