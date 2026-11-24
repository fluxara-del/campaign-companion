# Rollback i restore

## Načela

- **Kompatibilnost određuje baza, ne verzija aplikacije.** Slika je kompatibilna s bazom ako poznaje sve migracije zapisane u `_prisma_migrations` (`analyzeMigrations().compatible`). Starija slika nad novije migriranom bazom nije kompatibilna.
- **Automatski rollback samo na kompatibilnu verziju.** Ako nijedna prethodna verzija nije kompatibilna, aplikacija ostaje zaustavljena, a baza i kopija ostaju netaknute. Nema automatskog vraćanja podataka.
- **Restore podataka je uvijek ručna, izričita odluka**, jer briše (premješta) potvrđene događaje nastale nakon kopije.

## Scenariji u `deploy.sh`

| Situacija | Ponašanje |
|---|---|
| Procjena migracija nije prošla | Ništa se ne mijenja; stara verzija radi dalje. Workflow javlja neuspjeh. |
| Integritet/kopija nije prošla | Stara verzija se ponovno pokreće; deploy je zaustavljen. |
| `migrate deploy` nije uspio | Ako je stara slika i dalje kompatibilna (npr. migracija nije zapisana), pokreće se ona. Inače aplikacija ostaje zaustavljena uz poruku s imenom kopije. |
| Nova verzija nije zdrava | Ako je prethodna slika kompatibilna s (možda migriranom) bazom, pokreće se ona. Inače stop + ručni restore. |

## Ručni rollback aplikacije (bez vraćanja podataka)

GitHub → *Actions → Deploy (ZimaOS) → Run workflow*: `action=rollback`, `image=ghcr.io/fluxara-del/campaign-companion@sha256:<digest>`, `confirm=PRODUKCIJA`. Digest prethodne verzije je u `state/previous-image` na serveru, odnosno u sažetku ranijeg deploy joba. `deploy.sh` odbija rollback na sliku koja nije kompatibilna s bazom, a prije zamjene svejedno radi kopiju.

## Ručni restore podataka

Kada je baza oštećena ili migracija treba poništiti, na serveru kao administrator:

```bash
cd /DATA/AppData/campaign-companion
docker stop campaign-companion
IMG="$(cat state/current-image)"                 # ili slika kompatibilna s kopijom
B="$(cat state/last-backup)"                     # ili odabrana kopija iz backups/
run() { docker run --rm --network none --user 1000:1000 -v "$PWD/data:/data" -v "$PWD/backups:/backups" "$IMG" node node_modules/tsx/dist/cli.mjs "$@"; }
run scripts/db/verify.ts --backup "/backups/$B"                       # hash + integritet
run scripts/db/restore.ts --backup "/backups/$B" --db /data/app.db --confirm
run scripts/db/check-migrations.ts --db /data/app.db                  # mora biti compatible
KDZ_IMAGE="<slika kompatibilna s kopijom>" docker compose -f bin/compose.yaml up -d app
curl -fsS http://127.0.0.1:3000/api/health
```

Slika za pokretanje mora poznavati migracije zapisane u manifestu kopije (`appliedMigrations`). Prethodna baza ostaje kao `data/app.db.pre-restore-<vrijeme>` (s pripadnim `-wal/-shm`), dok je vlasnik izričito ne ukloni.

## Testiranost

- Automatski (CI, `tests/db/backup-restore.test.ts`): kopija obuhvaća WAL, izmijenjena kopija se otkriva hashom, restore vraća stanje i čuva prethodnu bazu, nekompatibilna (novija) baza se prepoznaje, destruktivna migracija se blokira.
- Docker smoke test u CI-u: migracije nad praznim volumenom, procjena, backup i health u stvarnoj slici.
- **Još nije testirano:** cijeli postupak na stvarnom ZimaOS-u (`deploy.sh`, compose, ovlasti datoteka). To je dio pilota prije prvog deploya.
