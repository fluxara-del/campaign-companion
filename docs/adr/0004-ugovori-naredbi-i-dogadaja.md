# ADR-0004: Tipizirani ugovori naredbi i događaja (nacrt)

Status: nacrt za Fazu 1. Izvor: specifikacija §6–§8. Implementacija (zod sheme, Prisma model) dolazi u Fazi 1 nakon odobrenja; ovdje se fiksira oblik ugovora.

## Envelope naredbe

```ts
type CommandEnvelope<T extends CommandType> = {
  schemaVersion: 1;
  commandId: string;            // UUID v7, generira klijent; idempotentni ključ unutar kampanje
  campaignId: string;
  expectedStateVersion: number; // optimistična konkurentnost; razlika → 409
  intentRef: IntentRef;         // igračev odabir | potvrđeno bacanje | dopuštena DM posljedica
  type: T;
  payload: CommandPayload[T];   // stroga zod shema po tipu; nepoznata polja odbijena
};
type IntentRef =
  | { kind: "player_choice"; turnId?: string; messageId: string }
  | { kind: "roll_result"; rollId: string }
  | { kind: "dm_consequence"; turnId: string; ruleRef: string };
type CommandBatch = { commands: CommandEnvelope<CommandType>[] }; // jedna transakcija, jedno povećanje stateVersion
```

Actor i ovlasti **ne** dolaze iz envelopea: server ih određuje iz autentificirane sesije ili AI service actora (uži scope).

## Početni tipovi naredbi

`ApplyDamage`, `ApplyHealing`, `SetTemporaryHp`, `ConsumeResource`, `ResolveCast`, `TransferItem`, `SpendCurrency`, `ApplyCondition`, `EndConcentration`, `RecordRoll`, `CompleteRest`, `AppendJournalNote`, `RecordWorldFact`, `CorrectConfirmedFact`.

Pravila payloada: stabilni ID-jevi (nikad samo naziv), cijeli brojevi za HP i novac (najmanja jedinica), eksplicitan izvor troška (`resourcePoolId` ili `freeUseFeatureId`), `null` za nepoznato.

## Obrada (nepromjenjiv redoslijed)

1. Autentifikacija, scope kampanje, veličina, tip i verzija sheme.
2. Receipt `(campaignId, commandId)` postoji → isti hash payloada vraća isti rezultat; drugi hash → 409 `command_id_reused`.
3. Kratka transakcija: provjera `expectedStateVersion`, preduvjeti pravila, izračun novog snapshot-a.
4. Atomski upis: snapshot + događaji + minimalni journal + receipt + `stateVersion + 1`.
5. Odgovor tek nakon commita. AI/HTTP pozivi nikad unutar transakcije.

Odgovori: `200` receipt; `409` zastarjela verzija ili ponovljeni ID s drugim payloadom; `422` nepodržano/neispravno (`needs_ruling`); `403` bez ovlasti.

## Envelope događaja

```ts
type DomainEvent = {
  id: string; campaignId: string; seq: number;   // (campaignId, seq) unique, raste po događaju
  sessionId: string | null; commandId: string;
  type: EventType; schemaVersion: number; payload: unknown; // tipizirano po (type, schemaVersion)
  actor: { kind: "player" | "dm_manual" | "ai_service" | "import"; id: string };
  sourceRef: string | null;                       // npr. legacy ID "KDZ-S001-E013"
  occurredAt: string;                             // UTC ISO
  worldTime: NarethTime | null;                   // vrijeme svijeta, odvojeno
  visibility: "player" | "dm" | "shared";
  knowledgeKind: "observed" | "reported" | "rumor" | "inferred" | "canon" | null;
};
```

Događaji su nepromjenjivi. Ispravka = novi događaj s `correctsEventId`. Legacy događaji iz uvoza čuvaju izvorni payload i hash (`actor.kind = "import"`), bez izmišljenih mehaničkih delta.

## AI prijedlog

AI vraća `{ narrativeDraft, proposedCommands: CommandEnvelope[], openRequests: (RollRequest | RulingRequest | DecisionRequest)[] }`. Prijedlog prolazi istu validaciju kao ručna naredba; nepotpun ili nevaljan JSON se ne izvršava. Auto-apply (Faza 6) samo za naredbe s valjanim `intentRef`, podržanim pravilom i točnom verzijom.
