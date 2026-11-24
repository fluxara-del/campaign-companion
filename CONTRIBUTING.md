# Način rada

## Grane i pull requestovi

- `main` je uvijek u stanju spremnom za deploy. Ne pusha se izravno (osim početnog commita).
- Svaka promjena ide kroz granu i PR:
  - `feature/faza-<n>-<kratki-opis>` za funkcionalnosti po fazama,
  - `fix/<opis>`, `docs/<opis>`, `chore/<opis>` za ostalo.
- PR mora proći CI (`Provjere …` i `Docker image i smoke test`) prije spajanja. Preferira se *squash merge*.
- Svaka faza završava PR-om s izvještajem o rezultatima i rizicima; sljedeća faza počinje tek nakon odobrenja vlasnika.

## Migracije baze

- Migracije nastaju samo s `npm run db:migrate:dev` i commitaju se zajedno s promjenom sheme.
- Primijenjena migracija se nikad ne mijenja; ispravak je nova migracija.
- Destruktivne naredbe (`DROP`, `DELETE`, Prisma *RedefineTables*) dopuštene su samo uz komentar
  `-- kdz:allow-destructive: <razlog>` i opis zaštite podataka u PR-u. CI i pre-deploy provjera ih inače blokiraju.
- Shema mora odgovarati migracijama (`prisma migrate diff` u CI-u).

## Testovi

- Testovi baze rade samo nad privremenim datotekama (`os.tmpdir()`); `tests/setup.ts` briše `DATABASE_URL`.
- Nikad ne pokretati testove s `NODE_ENV=production` ili nad kopijom produkcijske baze bez izričite odluke.

## Podaci kampanje

`E:\DnD\Kronike-Devet-Zvona` je izvan ovog repozitorija i ostaje read-only. Probni uvoz radi isključivo nad kopijom (vidi Fazu 2 u razvojnom planu).
