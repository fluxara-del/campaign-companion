# AGENTS.md — pravila za AI agente i code review

Vrijedi za sve agente (Codex review, ChatGPT supervisor, Claude Code). Glavni izvori: `docs/planning/02-specifikacija.md`, `docs/planning/03-razvojni-plan.md`, `CLAUDE.md`, `docs/operations/`.

## Uloge

| Uloga | Smije | Ne smije |
|---|---|---|
| Claude Code (Lead Developer) | Implementirati na feature grani, testove, PR, ispravke po reviewu | Merge, deploy, prelazak faze bez odobrenja |
| Codex (Independent Reviewer) | Komentirati PR s referencom na datoteku i liniju, predlagati ispravke | Pushati na radnu granu dok je Claude mijenja, odobriti merge umjesto vlasnika |
| ChatGPT (Technical Supervisor) | Procijeniti usklađenost sa specifikacijom, preporučiti prihvat/odbijanje | Smatrati PR ispravnim samo zato što CI prolazi |
| Vlasnik | Konačno odobrenje: merge, migracija stvarnih podataka, deploy | — |

AI review nije zamjena za testove. Nijedan PR se ne spaja automatski na temelju AI reviewa.

## Prioriteti reviewa

1. **Gubitak ili kvarenje podataka:** SQLite transakcije (kratke, bez AI/HTTP poziva unutra), atomarnost batcha, idempotentnost batcha (`batchId` + kanonski hash, zabrana ponovne uporabe `commandId`; ADR-0004), optimistična konkurentnost (`expectedStateVersion` → 409), redoslijed `seq` događaja.
2. **Migracije:** samo aditivne bez markera; `RedefineTables`/`DROP`/`DELETE` traže `-- kdz:allow-destructive:` i plan; nikad izmjena već primijenjene migracije; shema = migracije; kompatibilnost s prethodnom verzijom (rollback).
3. **Event log:** svaka potvrđena promjena ima događaj i receipt; ispravke su kompenzacijski događaji, nikad brisanje povijesti; replay od baseline-a daje isti snapshot.
4. **AI-generated state updates:** AI izlaz je samo prijedlog validiran shemom (zod); server određuje actor i scope; nevaljan/nepotpun JSON se ne izvršava; AI ne odlučuje umjesto igrača, ne izmišlja bacanja, ne mijenja kanon bez eksplicitne odluke; prompt injection iz sadržaja ne širi ovlasti.
5. **D&D pravila (profil `dnd5e-2024`):** temp HP odvojen od HP-a; resursi se obnavljaju samo potvrđenim odmorom; slot i besplatna uporaba nisu dvostruko terećenje; koncentracija; nepodržano pravilo → `needs_ruling`, ne pretpostavka.
6. **Privatnost:** DM sadržaj ne smije u player API, RSC payload, SSE, pretragu, export, logove ni greške.
7. **Sigurnost:** tajne samo na serveru; nema tajni u logovima; autentifikacija/origin; workflow permissions minimalni, akcije pinirane.
8. **Testovi:** pokrivaju li rubne slučajeve iz testne matrice plana; testovi samo nad privremenim bazama.
9. Performanse i čitljivost.

## Domenski invarijanti (sažetak)

- Bez potvrđenog upisa nema potvrđenog spremanja („Spremljeno, verzija N” tek nakon commita).
- `null` = nepoznato (npr. `heroicInspiration`); nikad tiho 0.
- Potrošeni resursi ostaju potrošeni dok `CompleteRest` nije valjan; nova sesija/dan nije odmor.
- Osobni novac i namjenski grupni novac su različiti računi.
- Predmet ima vlasnika, držatelja i lokaciju; količina nikad negativna; spremnici bez ciklusa.
- Entiteti uvijek pripadaju istoj kampanji (provjera u bazi i domeni).
- Vrste znanja (`observed`, `reported`, `rumor`, `inferred`, `canon`) i vidljivost (`player`, `dm`, `shared`) provjeravaju se na serveru.

## Kriteriji prihvata PR-a

- CI zelen (Provjere, Docker smoke test, PR pravila).
- PR referencira Issue i fazu, opisuje podatkovne rizike i postupak provjere/oporavka.
- Ispunjeni relevantni kriteriji iz `03-razvojni-plan.md` i §11 specifikacije za tu fazu.
- Sve Codex primjedbe riješene ili obrazloženo odbijene; supervisor preporuka zapisana u PR-u.
- Izričito odobrenje vlasnika.

## Format review komentara

`[ozbiljnost: blokirajuće|važno|sitno] datoteka:linija — problem — posljedica — prijedlog`.
