import { COMMAND_TYPES, type BatchCommand, type CommandType } from "./commands";
import { DomainError } from "./errors";

export type MemberRole = "owner" | "player" | "ai_service" | "viewer";
export type ActorKind = "player" | "ai_service";

/**
 * Dopuštene naredbe po ulozi. AI service actor ima uži scope od vlasnika (spec §6):
 * ne troši novac, ne piše DM bilješke i ne donosi igračeve odluke (trajne promjene lika,
 * priprema i bacanje čarolija, odmor, predmeti, rezultati bacanja). Smije primijeniti
 * posljedice koje DM razriješi (šteta, liječenje, uvjeti, kraj koncentracije).
 */
const AI_ALLOWED: readonly CommandType[] = [
  "ApplyDamage",
  "ApplyHealing",
  "SetTemporaryHp",
  "ConsumeResource",
  "AppendJournalNote",
  "ApplyCondition",
  "RemoveCondition",
  "EndConcentration",
];

/** Samo vlasnik (DM solo kampanje): sesije i ispravke potvrđene prošlosti. */
const OWNER_ONLY: readonly CommandType[] = ["StartSession", "EndSession", "CorrectConfirmedFact"];

const ALLOWED: Record<MemberRole, readonly CommandType[]> = {
  owner: COMMAND_TYPES,
  player: COMMAND_TYPES.filter((t) => !OWNER_ONLY.includes(t)),
  ai_service: AI_ALLOWED,
  viewer: [],
};

/** Naredbe koje izražavaju igračevu odluku moraju se pozivati na igračev odabir (ADR-0003). */
const REQUIRES_PLAYER_CHOICE: readonly CommandType[] = [
  "SetAbilityScore",
  "SetStatOverride",
  "SetSpellDetails",
  "SetSpellPrepared",
  "ResolveCast",
  "TransferItem",
  "SetEquipped",
  "CompleteRest",
  "SpendCurrency",
];

export function actorKindFor(role: MemberRole): ActorKind {
  return role === "ai_service" ? "ai_service" : "player";
}

export function authorizeBatch(role: MemberRole, commands: readonly BatchCommand[]): void {
  commands.forEach((c, commandIndex) => {
    if (!ALLOWED[role].includes(c.type)) {
      throw new DomainError("forbidden", "Uloga nema ovlast za ovu naredbu.", { commandIndex, type: c.type, role });
    }
    if (role === "ai_service" && c.type === "AppendJournalNote" && c.payload.visibility !== "player") {
      throw new DomainError("forbidden", "AI ne smije pisati DM ili zajedničke bilješke.", { commandIndex });
    }
    if (REQUIRES_PLAYER_CHOICE.includes(c.type) && c.intentRef.kind !== "player_choice") {
      throw new DomainError("validation", "Naredba izražava igračevu odluku i mora se pozivati na igračev odabir.", { commandIndex, type: c.type });
    }
    // Rezultat bacanja dolazi od igrača (ADR-0003): ne smije ga upisati AI ni DM posljedica.
    if (c.type === "ResolveRollRequest" && c.intentRef.kind !== "roll_result") {
      throw new DomainError("validation", "Rezultat bacanja mora se pozivati na igračevo bacanje (roll_result).", { commandIndex });
    }
  });
}
