# ADR-0001: Tehnološki stog i zaključane verzije

Status: prihvaćeno (Faza 0), 24. 11. 2026.

## Kontekst

Brief traži Next.js + React + TypeScript, Tailwind + shadcn/ui, Prisma + SQLite, Docker, GitHub Actions i AI adapter za OpenAI i Anthropic. Specifikacija upozorava da se ne miješaju generacije Prisma API-ja.

## Odluka

Verzije su provjerene na npm registryju 24. 11. 2026. i zaključane točno (bez `^`) u `package.json`, uz `package-lock.json`:

- **Node.js 24 LTS**. Prisma 7.10.1 traži `^22.18 || ^24.11 || >=26`; Vitest 5 traži `^22.12 || ^24 || >=26`.
- **Next.js 16.4.6, React 19.3.1**, App Router, jedan trajni Node proces (`next start`), bez serverless okruženja.
- **TypeScript 6.0.3.** TypeScript 7.0.2 je `latest`, ali typescript-eslint 8.x (dio eslint-config-next) podržava `<6.1.0`.
- **ESLint 9.39.5.** ESLint 10 postoji, ali dodaci u eslint-config-next (react, import) još ga ne podržavaju pouzdano.
- **Prisma ORM 7.10.1** (`prisma`, `@prisma/client`, `@prisma/adapter-better-sqlite3`). Oznaka `latest` paketa `prisma` trenutačno pokazuje na **8.0.0-rc.35 (prerelease)**, dok `@prisma/client` `latest` ostaje 7.10.1. Instalacija bez točne verzije dala bi nekompatibilan par CLI/klijent, zato je oboje zaključano na 7.10.1.
  - Prisma 7 oblik: `prisma.config.ts` drži URL baze, generator `prisma-client` generira u `src/generated/prisma` (ignorirano u Gitu, generira se u `postinstall`), pristup bazi ide kroz driver adapter.
  - Produkcijske migracije: isključivo `prisma migrate deploy`. `migrate dev`, `migrate reset` i `db push` nikad se ne koriste nad produkcijom.
- **better-sqlite3 12.11.1.** Adapter 7.10.1 traži `^12.6.0` (13.x nije podržan).
- **Tailwind 4.3.5** s CSS konfiguracijom (`@theme`), **shadcn/ui** preko `components.json`; komponente se dodaju kad zatrebaju (Faza 3).
- **Vitest 5.1.1**, projekti `unit` i `db`.
- **zod 4** za validaciju ugovora naredbi i AI izlaza (Faza 1/5).
- Ranjivost `effect <= 3.22.0` (GHSA-7589-6fvf-x4pw, tranzitivno kroz `@prisma/config`) riješena je `overrides` na `effect@3.22.5` (isti major); `npm audit` je čist.

## Posljedice

- Nadogradnje dolaze kroz Dependabot PR-ove i moraju proći CI.
- Prelazak na Prisma 8 je zasebna odluka nakon stabilnog izdanja.
- AI SDK-ovi (OpenAI, Anthropic) dodaju se u Fazi 5 iza vlastitog adaptera; ključevi ostaju samo na serveru.
