# Sigurnosna politika za SQLite bazu

## Pravila

1. **Lokacija.** Produkcijska baza je `/DATA/AppData/campaign-companion/data/app.db` na lokalnom disku ZimaOS-a, montirana u kontejner kao `/data`. Nikad u imageu, nikad u Gitu, nikad na mrežnom dijeljenju.
2. **Jedan pisac.** Jedna instanca aplikacije; kratke transakcije; AI poziv nikad unutar otvorene transakcije (specifikacija §5).
3. **Nikad destruktivne naredbe nad produkcijom:** zabranjeni su `prisma migrate reset`, `prisma db push`, `migrate dev`, ručni `DROP`/`DELETE` i brisanje datoteka baze. Restore ne briše postojeću bazu nego je premješta u `*.pre-restore-<vrijeme>`.
4. **Samo verzionirane migracije** iz `prisma/migrations`, primijenjene s `prisma migrate deploy`.
5. **Kopija prije svake migracije**, uvijek kroz SQLite Online Backup API (obuhvaća i sadržaj WAL-a). Kopiranje samo `.db` datoteke nije valjana kopija.
6. **Testovi nikad ne diraju produkcijsku bazu.** CI nema pristup serveru; DB testovi rade u `os.tmpdir()`; `tests/setup.ts` briše `DATABASE_URL`.

## Postupak prije migracije (automatiziran u `deploy.sh`)

| Korak | Alat | Ako ne uspije |
|---|---|---|
| 1. Procjena kompatibilnosti: pending migracije, nepoznate (novije) migracije u bazi, neuspjele migracije, neodobrene destruktivne naredbe, redoslijed | `scripts/db/check-migrations.ts --db` iz **nove** slike | Prekid prije ikakve promjene; aplikacija i dalje radi |
| 2. Zaustavljanje pisanja | `docker stop` | — |
| 3. Stanje baze | `PRAGMA integrity_check` + `foreign_key_check` (`verify.ts`) | Prekid, stara verzija se ponovno pokreće, podaci netaknuti |
| 4. Konzistentna kopija + manifest (sha256, verzija SQLite-a, primijenjene migracije) | `backup.ts` | Prekid, stara verzija se ponovno pokreće |
| 5. Provjera kopije (hash + integrity_check) | `verify.ts --backup` | Prekid, stara verzija se ponovno pokreće |
| 6. Primjena migracija | `prisma migrate deploy` | Vidi [rollback i restore](rollback-i-restore.md) |
| 7. Health check (`/api/health`: baza dostupna, 0 pending, shema kompatibilna) | `curl` | Vidi rollback |

## Destruktivne migracije

`check-migrations.ts` i CI blokiraju `DROP TABLE/COLUMN/INDEX/VIEW/TRIGGER`, `DELETE FROM` i `TRUNCATE`. Prisma za SQLite promjenu stupca radi kao *RedefineTables* (nova tablica → kopiranje → `DROP` stare), pa i to traži izričito odobrenje markerom `-- kdz:allow-destructive: <razlog>` i opis u PR-u. Preferira se *expand → migrate → contract* u odvojenim izdanjima, tako da prethodna verzija aplikacije ostane kompatibilna.

## Rutinske kopije

Prema razvojnom planu (Faza 7) automatske periodične kopije uključuju se tek nakon provjerenog restore postupka na stvarnom serveru. Do tada postoje kopije prije svakog deploya. Prijedlog za kasnije: dnevna kopija, čuvanje 14 dnevnih + 8 tjednih, plus kopija izvan ZimaOS-a (otvorena odluka).
