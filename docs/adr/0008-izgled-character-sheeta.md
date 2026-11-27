# ADR-0008: Izgled character sheeta prema vlasnikovu primjeru

Status: prihvaćeno — odluka vlasnika 26. 11. 2026. (poruka u projektnoj niti: „želim kopiju izgleda sa primjera, izmjeni specifikaciju”).

## Kontekst

Specifikacija (§1, §3) i analiza (§10) tražile su originalan vizualni sustav i zabranjivale preuzimanje kompozicije, okvira i stila referentnog proizvoda. Vlasnik je za character sheet dao primjer (`primjer dizajna ui.png`, snimka zaslona, lokalno i izvan Gita) i izričito zatražio izgled prema njemu, nakon što su mu predstavljene tri opcije (isti raspored s vlastitim stilom, izgled prema primjeru, sadašnji izgled).

## Odluka

- Character sheet slijedi primjer u rasporedu, bojama, okvirima i hijerarhiji: tamna gornja traka (ime, razina, radnje odmora), svijetla pozadina, bijeli okviri s crvenim rubom, atributi s modifikatorom i vrijednošću u ovalu, HP okvir s Liječenje/iznos/Šteta, saving throwovi, osjetila, tablica vještina (PROF · ATR · VJEŠTINA · BONUS), radni panel s karticama i crvenom oznakom aktivne kartice.
- Izgled se izrađuje **vlastitim kodom i CSS-om** (Tailwind). Ne preuzimaju se slike, pozadinske ilustracije, logotipi, portreti, fontovi, ikone, SVG okviri, CSS ni tekstovi pravila; naziv proizvoda i sve oznake su vlastiti i na hrvatskom. Snimka primjera ne ulazi u repozitorij.
- Zahtjevi pristupačnosti iz §3 i dalje vrijede (≥ 44 px mete, tipkovnica, vidljiv fokus, tekst uz boju, bez ovisnosti o hoveru, 390 px bez horizontalnog skrola).

## Posljedice

- Ostale cjeline (Igra, Dnevnik) za sada nasljeđuju isti vizualni sustav radi dosljednosti.
- Rizik: sličnost s komercijalnim proizvodom; ublaženo time što je aplikacija privatna i self-hosted te ne koristi tuđe assete ni kod. Prije bilo kakve javne objave izgled treba ponovno procijeniti.
