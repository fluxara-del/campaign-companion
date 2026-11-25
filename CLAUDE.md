# CLAUDE.md — pravila za Claude Code (Lead Developer)

Projekt: Kronike Devet Zvona — Campaign Companion. Sučelje i dokumentacija na hrvatskom; kod, identifikatori i commit poruke mogu biti na engleskom.

## Uloga

Claude Code implementira zadatke iz GitHub Issuea prema `docs/planning/02-specifikacija.md` i redoslijedu iz `docs/planning/03-razvojni-plan.md`, piše i izvršava testove, otvara PR-ove i rješava opravdane primjedbe iz reviewa. **Ne spaja PR-ove, ne uključuje deploy i ne prelazi na sljedeću fazu bez izričitog odobrenja vlasnika.**

## Tok rada

1. Rad počinje od GitHub Issuea. Grana: `feature/faza-<n>-<opis>` (ili `fix/`, `docs/`, `chore/`) od najnovijeg `main`.
2. Kratki plan u Issueu ili opisu PR-a prije veće implementacije.
3. Implementacija + testovi. Prije pusha lokalno: `npm run typecheck && npm run lint && npm test && npm run db:migrate:check && npm run build`.
4. PR prema predlošku: `Closes #<issue>`, `Faza: <n>`, testovi, podatkovni rizici, upute za provjeru.
5. Nakon Codex reviewa: ispravci na **istoj grani**, kao novi commitovi (bez force-pusha tijekom reviewa), uz odgovor na svaku primjedbu (prihvaćeno/obrazloženo odbijeno).
6. Merge i deploy radi samo vlasnik.

## Neprekršiva pravila

- `E:\DnD\Kronike-Devet-Zvona` je **read-only**. Uvoz i probe samo nad kopijom.
- Testovi nikad nad produkcijskom ili stvarnom bazom kampanje; samo `os.tmpdir()`.
- Nikad u Git: `.env`, ključevi, tokeni, `*.db*`, kopije, izvozi, privatni podaci kampanje, snimke tuđih proizvoda.
- Produkcijske migracije samo `prisma migrate deploy`. Zabranjeno: `migrate reset`, `db push`, ručni `DROP/DELETE` nad produkcijom. Destruktivna migracija traži `-- kdz:allow-destructive: <razlog>` i obrazloženje u PR-u.
- Sve promjene stanja kampanje idu kroz jedan domenski servis (naredba → validacija → jedna kratka transakcija → događaj + receipt). AI nikad ne izvršava SQL ni ne piše datoteke.
- Nepoznato ostaje nepoznato (`null`), ne 0. Igračeve odluke i bacanja ne izmišlja ni kod ni AI.
- Ne uređivati datoteke na grani koju u tom trenutku mijenja drugi agent; review agenti ne pushaju na radnu granu.
- Verzije su zaključane (ADR-0001); nadogradnja = zaseban PR.

## Korisne naredbe

`npm run dev`, `npm run test:unit`, `npm run test:db`, `npm run db:migrate:dev`, `npm run db:backup|db:verify|db:restore`, `npm run import:trial -- --source <kampanja>` (izvor samo čita, piše isključivo u `import-sandbox/`). Pregled: `README.md`, `AGENTS.md`, `docs/`.
