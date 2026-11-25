# ADR-0003: Razvojni ugovor — igračeva odluka, ručna bacanja, lokalni autoritet, nepoznate vrijednosti

Status: predloženo (gate Faze 0 iz `03-razvojni-plan.md`); prihvaća vlasnik.

Ova četiri pravila obvezuju svaki budući PR. Reviewer (Codex) i supervisor ih provjeravaju izričito (`AGENTS.md`).

## 1. Igračeva odluka (player agency)

- Radnje lika („napadam”, „trošim slot”, „prihvaćam zadatak”, „odmaram”) nastaju **samo** iz igračeva stvarnog odabira u sučelju ili poruke koju je igrač poslao. `intentRef` naredbe pokazuje na taj odabir.
- AI DM smije predložiti opcije; prijedlog odluke umjesto igrača nikad ne postaje događaj (spec §8).
- Ispravak potvrđene prošlosti (kanona) traži igračev izričit izbor i stvara korekcijski događaj; ništa se ne briše.

## 2. Ručna bacanja

- Zadano bacanja unosi igrač (`RollResult.origin = "manual"`). AI i server ne izmišljaju rezultat.
- Kad pravilo traži bacanje, turn prelazi u `awaiting_roll`; mehaničko stanje se ne mijenja dok rezultat ne stigne.
- Server-generirana bacanja (P2) moguća su tek kao zasebna, vidljivo označena opcija (`origin = "system"`).

## 3. Lokalni autoritet

- **Do potvrđenog cutovera** autoritet su datoteke u `E:\DnD\Kronike-Devet-Zvona`; aplikacija ih ne mijenja. Uvoz radi nad kopijom i može se odbaciti (Faza 2).
- **Nakon cutovera** autoritet je jedna SQLite baza na jednom poslužitelju (ZimaOS). Nema dual-writea s datotekama ni druge autoritativne baze (npr. na mobitelu). JSON/Markdown postaju generirane projekcije.
- „Spremljeno, verzija N” prikazuje se tek nakon commita transakcije. Naracija, AI prijedlog i optimistični prikaz nisu dokaz upisa.

## 4. Nepoznate vrijednosti

- Nepoznato je `null` (ili `known = false` u ResourcePoolu), nikad 0, prazan string ili pretpostavljena vrijednost — kroz import, uređivanje, AI prijedlog i export.
- Primjeri iz postojeće kampanje: `heroicInspiration: null`, nepoznata masa predmeta, nepoznat držatelj predmeta.
- Sukob strukturiranog polja i povijesnog Markdowna prijavljuje se u migracijskom izvještaju; ne razrješava se tiho.

## Posljedice

- Testovi Faze 1–6 moraju sadržavati negativne slučajeve za svako pravilo (AI pokušava odlučiti umjesto igrača, izmisliti bacanje, pretvoriti `null` u 0).
- Svako odstupanje traži novi ADR.
