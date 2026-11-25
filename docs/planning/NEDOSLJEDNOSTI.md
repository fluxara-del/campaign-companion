# Nedosljednosti među dokumentima i otvorene odluke

Pregled: `01-analiza-ddb.md`, `02-specifikacija.md`, `03-razvojni-plan.md` i brief vlasnika (24. 11. 2026.). Specifikacija je glavni dokument; razvojni plan određuje redoslijed; brief vlasnika ima prednost gdje je izričit.

## Nedosljednosti i predložena rješenja

| # | Nedosljednost | Prijedlog |
|---|---|---|
| N1 | **Sadržaj Faze 0.** Plan: Faza 0 su odluke i ugovori (ADR-ovi, popis sadržaja, command/event ugovori, nepodržana pravila), „prije scaffolda”. Brief: Faza 0 uključuje repozitorij, scaffold, CI i deploy strategiju. | Faza 0 obuhvaća oboje. Infrastruktura je gotova; ugovori koji ovise o odlukama O1–O5 ostaju zadnji korak Faze 0 i ne blokiraju infrastrukturu. Scaffold ne sadrži domenski model. |
| N2 | **Lokalno vs. poslužitelj.** Spec §9: početni servis veže se na loopback; plan ostavlja otvoreno „desktop-only ili mobitel preko privatne mreže”. Brief: produkcija je ZimaOS, pristup s mobitela. | Odabran ZimaOS + Tailscale. Aplikacija i dalje sluša samo na loopbacku servera; pristup ide kroz `tailscale serve`. Posljedica: autentifikacija, origin/CSRF i scope kampanje (spec §9, plan Faza 7) moraju postojati **prije** nego se aplikacija koristi s mobitela, a ne tek u Fazi 7. Predlažem ih u Fazi 1/3. |
| N3 | **Vremenska zona.** Spec §6 i analiza koriste prikaz `Europe/Warsaw`; vlasnik je u Hrvatskoj. | Spremanje UTC; prikaz konfigurabilan, prijedlog zadane vrijednosti `Europe/Zagreb` (isti offset). **Otvorena odluka vlasnika — nije odlučeno**; do odluke specifikacija (`Europe/Warsaw`) ostaje važeća. |
| N4 | **Verzija Prisma.** Spec traži zaključavanje u „prvoj razvojnoj fazi” i upozorava na miješanje generacija; brief traži „aktualne” verzije. npm `latest` za `prisma` je 8.0.0-rc (prerelease), a za `@prisma/client` 7.10.1. | Zaključano na stabilnu 7.10.1 za oboje (ADR-0001). Prisma 8 nakon stabilnog izdanja, zasebnim PR-om. |
| N5 | **Automatske kopije.** Plan (Faza 7): backup automatizirati tek nakon provjerenog restorea. Brief: backup prije svake migracije pri deployu. | Nema konflikta u praksi: kopija prije migracije je dio deploya od prvog dana, restore je testiran u CI-u; periodične kopije čekaju pilot restore na serveru. |
| N6 | **Automatski deploy vs. „autoritativni alat tek nakon Faze 7”.** | Auto-deploy se uključuje tek nakon pilota (Faza 7). Do tada su stare datoteke autoritet, a server može služiti samo za sintetičke podatke. |
| N7 | **Linkovi u dokumentima.** Analiza referencira `evidence/` i `screenshots/` koji postoje samo u `Kronike-Devet-Zvona/docs/campaign-companion/`. | Ne kopiraju se u repozitorij (snimke tuđeg proizvoda). Linkovi ostaju neispravni namjerno; dokazi su u izvornoj mapi kampanje. |
| N8 | **`primjer dizajna ui.png`** u mapi aplikacije je snimka D&D Beyond sučelja; spec §1 i analiza §10 zabranjuju preuzimanje tuđeg dizajna i asseta. | Datoteka ostaje lokalno, ali je u `.gitignore` i služi samo kao funkcionalna referenca (koje informacije su vidljive), ne kao vizualni predložak. |
| N9 | **AI provider.** Plan: otvorena odluka. Brief: adapter za OpenAI i Anthropic. | Adapter podržava oba (Faza 5); zadani provider, model i granice troška su odluka O2. |
| N10 | **Auto-apply.** Brief traži automatsko ažuriranje potvrđenog stanja; plan ga uvodi postupno (Faza 5 samo prijedlozi, Faza 6 auto-apply). | Slijedi se plan; brief se ispunjava u Fazi 6. |
| N11 | **Naziv repozitorija.** Brief: „Campaign companion”; GitHub ne dopušta razmake. | `campaign-companion`. |
| N12 | **Stanje kampanje u specifikaciji** (`stateVersion: 2`, `KDZ-S001-E013`, 23. 11.) je snimka, ne činjenica. | Importer uvijek ponovno čita izvore; brojke iz specifikacije služe samo kao regresijski primjer. |
| N14 | **Ugovor naredbi.** Spec §7 opisuje idempotentnost po `commandId` i endpoint `/commands`, a složene radnje kao batch. | ADR-0004 (SR-01): jedinica idempotentnosti je batch (`batchId`, kanonski hash, jedan receipt); pojedinačna naredba je batch s jednim članom; endpoint `/batches`. **Primijenjeno:** §6, §7 i §4 specifikacije te testna matrica plana usklađeni su s ADR-0004 (kopija u ovom repozitoriju; izvorna kopija u mapi kampanje nije mijenjana). |
| N13 | **Zaštita grane i odobrenja na besplatnom planu.** Brief traži zaštitu `main` i odobrenje vlasnika; na privatnom repozitoriju to traži GitHub Pro. Uz to GitHub ne dopušta autoru da odobri vlastiti PR, a PR-ove otvara vlasnikov račun. | Vidi izvještaj Faze 0 i `docs/operations/multi-agent-workflow.md`. |

## Otvorene odluke (blokiraju ugovore na kraju Faze 0 ili kasnije faze)

| # | Odluka | Preporuka |
|---|---|---|
| O1 | Opseg podržanih 2024 pravila i početni katalog sadržaja (samo originalni/SRD 5.2 CC-BY sadržaj?) | SRD 5.2 (CC-BY-4.0) + korisnikov sadržaj, uz polja podrijetla; popis nepodržanih pravila u ADR-u |
| O2 | AI provider, model, mjesečni limit troška, timeout, pohrana promptova | Adapter za oba; početno jedan provider; logovi bez punih promptova |
| O3 | DM tajne u AI kontekstu u MVP-u | Ne: javni narator ne dobiva tajne (spec §9) |
| O4 | Opseg borbenog trackera | Samo osobni resursi i potezi lika u MVP-u |
| O5 | Autentifikacija za pristup preko tailneta | Jedan vlasnički račun (lozinka/passkey) + sesija; Tailscale ACL kao prvi sloj |
| O6 | Kopija izvan ZimaOS-a | Šifrirana kopija na drugi uređaj ili cloud nakon pilota |
| O7 | Arhitektura ZimaOS hosta (amd64/arm64) | Potvrditi |
