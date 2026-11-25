# ADR-0005: Podrijetlo sadržaja i opseg pravila `dnd5e-2024` (nacrt)

Status: nacrt; konačni opseg ovisi o odluci O1 (`docs/planning/NEDOSLJEDNOSTI.md`).

## Podrijetlo sadržaja

Svaka definicija (čarolija, osobina, predmet, pravilo) nosi:

```ts
type ContentProvenance = {
  source: "original" | "user" | "srd-5.2" | "campaign-import";
  license: "proprietary-owner" | "CC-BY-4.0" | "user-provided";
  attribution: string | null;   // obavezno za CC-BY (SRD 5.2)
  rulesetId: "dnd5e-2024"; rulesetVersion: string;
};
```

| Izvor | Dopušteno | Napomena |
|---|---|---|
| Originalni sadržaj kampanje (Nareth) | Da | Vlasnik |
| Korisnikov tekst (vlastiti opisi lika, bilješke) | Da | Ne izlaže se javno |
| SRD 5.2 (CC-BY-4.0) | Da, uz atribuciju | Preporuka za početni katalog |
| D&D Beyond tekstovi, slike, CSS, fontovi, kod | **Ne** | Spec §1, analiza §10 |
| Sadržaj kupljenih knjiga izvan SRD-a | Samo kao korisnikov vlastiti sažetak | Bez automatskog uvoza |

## Početni opseg automatizacije (prijedlog za MVP)

Automatski (uz test): HP/temp HP/šteta/liječenje s granicama; potrošnja i obnova ResourcePoola samo kroz potvrđen kratki/dugi odmor; spell slots jedne klase i besplatne uporabe; priprema/poznavanje čarolija; koncentracija (početak/kraj, zahtjev za save); inventar (količina, vlasnik/držatelj/lokacija, spremnici, transfer); odvojeni novčanici; uvjeti s eksplicitnim trajanjem.

## Namjerno nepodržano u MVP-u (→ `needs_ruling` ili ručna korekcija)

- Death saves i masivna šteta.
- Višeklasni spell slotovi i pravila koja ih kombiniraju.
- Složene reakcije, prilike napada, pokreti na karti, područja učinka.
- Puni encounter/VTT tracker i potezi protivnika (ovisno o O4).
- Automatski preračun izvedenih vrijednosti izvan onih koje profil eksplicitno podržava.
- Level-up automatizacija (napredak je milestone; ručno uz događaj).
- Opterećenje (encumbrance) kad je masa nepoznata.
- Bilo koje pravilo bez vlastitog testa.

Svako nepodržano pravilo u UI-u se prikazuje kao otvoren zahtjev za DM odluku, nikad kao tiho zaokruživanje ili pretpostavka.
