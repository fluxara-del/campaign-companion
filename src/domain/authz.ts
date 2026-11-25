import type { BatchCommand, CommandType } from "./commands";
import { DomainError } from "./errors";

export type MemberRole = "owner" | "player" | "ai_service" | "viewer";
export type ActorKind = "player" | "ai_service";

const ALL: readonly CommandType[] = [
  "ApplyDamage",
  "ApplyHealing",
  "SetTemporaryHp",
  "ConsumeResource",
  "SpendCurrency",
  "AppendJournalNote",
];

/**
 * Dopuštene naredbe po ulozi. AI service actor ima uži scope od vlasnika (spec §6):
 * ne troši novac i ne piše DM-vidljive bilješke. Privremeno za Fazu 1; revizija u Fazi 5.
 */
const ALLOWED: Record<MemberRole, readonly CommandType[]> = {
  owner: ALL,
  player: ALL,
  ai_service: ["ApplyDamage", "ApplyHealing", "SetTemporaryHp", "ConsumeResource", "AppendJournalNote"],
  viewer: [],
};

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
  });
}
