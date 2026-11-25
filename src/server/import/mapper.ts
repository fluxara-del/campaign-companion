import { readFileSync } from "node:fs";
import path from "node:path";
import type { ResourcePoolState, WalletState } from "@/domain/state";
import { sha256 } from "./source-snapshot";
import type { DocumentRow, EntityRow, Finding, ImportPlan, ItemRow, LegacyEventRow, SourceManifest } from "./types";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const pad = (n: number) => String(n).padStart(3, "0");
const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

function readText(root: string, rel: string): string {
  return readFileSync(path.join(root, ...rel.split("/")), "utf8").replace(/^﻿/, "");
}

function readJson(root: string, rel: string, findings: Finding[]): Obj | null {
  try {
    const v = JSON.parse(readText(root, rel)) as unknown;
    if (!isObj(v)) throw new Error("Korijen nije objekt");
    return v;
  } catch (err) {
    findings.push({ code: "json_invalid", severity: "error", message: `Neispravan JSON: ${(err as Error).message}`, source: rel });
    return null;
  }
}

const RECHARGE = new Set(["short_rest", "long_rest", "manual"]);
const COIN_IN_CP: Record<string, number> = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

/**
 * Čisto mapiranje kopiranih izvora u plan uvoza. Ne izmišlja vrijednosti: nepoznato ostaje
 * `null`, a sve što nije mapirano čuva se u profilu ili sirovom JSON-u i prijavljuje u nalazima.
 */
export function buildImportPlan(
  copyRoot: string,
  manifest: SourceManifest,
  opts: { ownerActorId: string },
): { plan: ImportPlan | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const mapping: Record<string, string> = {};
  const state = readJson(copyRoot, "state/current-state.json", findings);
  const character = readJson(copyRoot, "state/character.json", findings);
  const npcsFile = readJson(copyRoot, "npcs/npcs.json", findings);
  const questsFile = readJson(copyRoot, "quests/quests.json", findings);
  if (!state || !character || !npcsFile || !questsFile) return { plan: null, findings };

  const campaignId = str(state.campaignId);
  const pcId = str(character.id);
  if (!campaignId) findings.push({ code: "campaign_id_missing", severity: "error", message: "current-state.json nema campaignId." });
  if (!pcId) findings.push({ code: "character_id_missing", severity: "error", message: "character.json nema id." });
  if (!campaignId || !pcId) return { plan: null, findings };
  if (str(state.playerCharacterId) !== pcId) {
    findings.push({
      code: "player_character_mismatch",
      severity: "error",
      message: "playerCharacterId u stanju ne odgovara ID-u lika.",
      details: { state: state.playerCharacterId ?? null, character: pcId },
    });
  }

  // --- Lik: HP. Nepoznat HP ili privremeni HP blokira uvoz (ne pretpostavlja se 0).
  const hp = int(character.hp);
  const hpMax = character.maxHp === null ? null : int(character.maxHp);
  const hpTemp = int(character.temporaryHp);
  if (hp === null) findings.push({ code: "hp_unknown", severity: "error", message: "Trenutačni HP nije cijeli broj; potrebna je odluka.", source: "state/character.json#hp" });
  if (hpTemp === null) {
    findings.push({ code: "temp_hp_unknown", severity: "error", message: "Privremeni HP nije naveden; ne pretpostavlja se 0.", source: "state/character.json#temporaryHp" });
  }
  if (hp !== null && hpMax !== null && hp > hpMax) {
    findings.push({ code: "hp_over_max", severity: "error", message: "HP je veći od maksimuma.", details: { hp, hpMax } });
  }

  // --- Resursi.
  // Izostavljeno ili `null` = nepoznato; inače mora biti cijeli broj ≥ 0 (neispravno blokira, ne postaje tiho null).
  const nullableCount = (v: unknown, src: string): number | null => {
    if (v === undefined || v === null) return null;
    const n = int(v);
    if (n === null || n < 0) {
      findings.push({ code: "resource_value", severity: "error", message: "Vrijednost resursa nije cijeli broj ≥ 0.", source: src });
      return null;
    }
    return n;
  };
  const PRESERVED = "izvorna vrijednost ostaje doslovno sačuvana u SourceDocument (state/character.json)";
  const pools: ResourcePoolState[] = [];
  const resources = isObj(character.resources) ? character.resources : {};
  for (const [key, value] of Object.entries(resources)) {
    const src = `state/character.json#resources.${key}`;
    if (key === "spellSlots" && isObj(value)) {
      for (const [level, slot] of Object.entries(value)) {
        const slotSrc = `${src}.${level}`;
        if (!/^[1-9]$/.test(level) || !isObj(slot) || !("current" in slot)) {
          findings.push({ code: "resource_shape", severity: "warning", message: `Neočekivan oblik spell slota; nije mapiran, ${PRESERVED}.`, source: slotSrc });
          continue;
        }
        const current = nullableCount(slot.current, `${slotSrc}.current`);
        const max = nullableCount(slot.max, `${slotSrc}.max`);
        if (current === null || max === null) {
          findings.push({ code: "unknown_preserved", severity: "info", message: `Spell slot razine ${level}: nepoznata vrijednost ostaje nepoznata.`, source: slotSrc });
        }
        const id = `${pcId}:spell-slot-${level}`;
        pools.push({ id, characterId: pcId, resourceKey: `spell-slot-${level}`, current, max, rechargePolicy: null });
        mapping[`${src}.${level}`] = id;
      }
      continue;
    }
    const resourceKey = key === "hitDice" && isObj(value) && str(value.die) ? `hit-dice-${str(value.die)}` : kebab(key);
    const id = `${pcId}:${resourceKey}`;
    if (value === null) {
      pools.push({ id, characterId: pcId, resourceKey, current: null, max: null, rechargePolicy: null });
      findings.push({ code: "unknown_preserved", severity: "info", message: `Resurs ${key} je nepoznat (null) i ostaje nepoznat.`, source: src });
      mapping[src] = id;
      continue;
    }
    if (!isObj(value) || !("current" in value)) {
      findings.push({ code: "resource_shape", severity: "warning", message: `Resurs ${key} nema oblik {current, max}; nije mapiran, ${PRESERVED}.`, source: src });
      continue;
    }
    const current = nullableCount(value.current, `${src}.current`);
    const max = nullableCount(value.max, `${src}.max`);
    const recharge = str(value.recharge);
    if (recharge && !RECHARGE.has(recharge)) {
      findings.push({ code: "recharge_unknown", severity: "warning", message: `Nepoznata politika obnove „${recharge}”; postavljeno nepoznato.`, source: src });
    }
    if (!recharge) {
      findings.push({
        code: "recharge_not_stated",
        severity: "info",
        message: `Izvor ne navodi obnovu za ${key}; ostaje nepoznato do podrške pravila (Faza 3).`,
        source: src,
      });
    }
    pools.push({
      id,
      characterId: pcId,
      resourceKey,
      current,
      max,
      rechargePolicy: recharge && RECHARGE.has(recharge) ? (recharge as ResourcePoolState["rechargePolicy"]) : null,
    });
    mapping[src] = id;
  }
  for (const p of pools) {
    if (p.current !== null && p.max !== null && p.current > p.max) {
      findings.push({ code: "resource_over_max", severity: "error", message: `Resurs ${p.resourceKey}: current > max.`, details: { current: p.current, max: p.max } });
    }
  }

  // --- Novac: osobni i namjenski fondovi su odvojeni računi.
  const wallets: WalletState[] = [];
  const toCp = (coins: Obj, src: string): number | null => {
    let total = 0;
    for (const [coin, amount] of Object.entries(coins)) {
      const rate = COIN_IN_CP[coin];
      const n = int(amount);
      if (rate === undefined || n === null) {
        if (coin === "purpose" || coin === "sourceNpcId" || coin === "personalFunds") continue;
        findings.push({ code: "currency_shape", severity: "warning", message: `Nepoznata valuta ili iznos „${coin}”.`, source: src });
        return null;
      }
      total += n * rate;
    }
    return total;
  };
  if (isObj(character.currency)) {
    const id = `${pcId}:wallet:personal`;
    wallets.push({ id, ownerCharacterId: pcId, purpose: "personal", label: "Osobni novac", currency: "cp", amountMinor: toCp(character.currency, "state/character.json#currency") });
    mapping["state/character.json#currency"] = id;
  } else {
    findings.push({ code: "currency_missing", severity: "warning", message: "Lik nema navedenu valutu; osobni novčanik nije stvoren." });
  }
  if (isObj(state.groupFunds)) {
    const g = state.groupFunds;
    if (g.personalFunds !== false) {
      findings.push({ code: "group_funds_ambiguous", severity: "warning", message: "groupFunds nije izričito označen kao ne-osobni novac.", source: "state/current-state.json#groupFunds" });
    }
    const id = `${campaignId}:wallet:group-1`;
    wallets.push({
      id,
      ownerCharacterId: null,
      purpose: "group_dedicated",
      label: str(g.purpose) ?? "Namjenski grupni fond",
      currency: "cp",
      amountMinor: toCp(g, "state/current-state.json#groupFunds"),
    });
    mapping["state/current-state.json#groupFunds"] = id;
  }
  const totalGp = int(state.personalAndGroupFundsTotalGp);
  if (totalGp !== null) {
    const sum = wallets.reduce((a, w) => (a === null || w.amountMinor === null ? null : a + w.amountMinor), 0 as number | null);
    if (sum !== null && sum !== totalGp * 100) {
      findings.push({ code: "funds_total_mismatch", severity: "warning", message: "Zbroj novčanika ne odgovara navedenom ukupnom iznosu.", details: { sumCp: sum, statedGp: totalGp } });
    } else if (sum !== null) {
      findings.push({ code: "funds_total_ok", severity: "info", message: `Ukupno ${totalGp} GP odgovara zbroju odvojenih novčanika; osobni i namjenski novac ostaju odvojeni.` });
    }
  }

  // --- Predmeti: posjed (equipment) i predmeti izvan inventara.
  // Izostavljena ili izričito `null` količina = nepoznato; svaka druga vrijednost mora biti cijeli broj ≥ 0.
  const itemQuantity = (value: unknown, src: string): number | null => {
    if (value === undefined || value === null) return null;
    const n = int(value);
    if (n === null || n < 0) {
      findings.push({ code: "item_quantity", severity: "error", message: "Količina nije cijeli broj ≥ 0.", source: src });
      return null;
    }
    return n;
  };
  const items: ItemRow[] = [];
  const equipment = Array.isArray(character.equipment) ? character.equipment : [];
  equipment.forEach((raw, i) => {
    const src = `state/character.json#equipment[${i}]`;
    if (!isObj(raw) || !str(raw.name)) {
      findings.push({ code: "item_shape", severity: "error", message: "Predmet bez imena.", source: src });
      return;
    }
    const quantity = itemQuantity(raw.quantity, src);
    const id = `${pcId}:item:${pad(i + 1)}`;
    items.push({
      id,
      name: str(raw.name)!,
      quantity,
      ownerRef: str(raw.ownerId),
      holderRef: str(raw.holderId) ?? pcId,
      location: str(raw.location),
      containerItemId: null,
      equipped: typeof raw.equipped === "boolean" ? raw.equipped : null,
      attuned: typeof raw.attuned === "boolean" ? raw.attuned : null,
      stateNote: str(raw.state),
      attributes: raw,
      sourceRef: src,
    });
    mapping[src] = id;
  });
  // Spremnici po imenu (izvor nema ID-jeve predmeta).
  equipment.forEach((raw, i) => {
    if (!isObj(raw) || !str(raw.container)) return;
    const containerName = str(raw.container)!;
    const candidates = items.filter((it) => it.name === containerName);
    const item = items.find((it) => it.sourceRef === `state/character.json#equipment[${i}]`);
    if (!item) return;
    if (candidates.length === 1 && candidates[0]!.id !== item.id) {
      item.containerItemId = candidates[0]!.id;
    } else {
      findings.push({
        code: "container_unresolved",
        severity: "warning",
        message: `Spremnik „${containerName}” nije jednoznačno pronađen; veza nije postavljena.`,
        source: item.sourceRef,
      });
    }
  });
  const unownedHeld = items.filter((it) => it.ownerRef === null).length;
  if (unownedHeld > 0) {
    findings.push({
      code: "ownership_not_stated",
      severity: "info",
      message: `${unownedHeld} predmeta u inventaru nema navedenog vlasnika: držatelj je lik, vlasnik ostaje nepoznat.`,
    });
  }
  const external = Array.isArray(character.externalItems) ? character.externalItems : [];
  external.forEach((raw, i) => {
    const src = `state/character.json#externalItems[${i}]`;
    if (!isObj(raw) || !str(raw.name)) {
      findings.push({ code: "item_shape", severity: "error", message: "Vanjski predmet bez imena.", source: src });
      return;
    }
    const id = `${campaignId}:external-item:${pad(i + 1)}`;
    items.push({
      id,
      name: str(raw.name)!,
      quantity: itemQuantity(raw.quantity, src),
      ownerRef: str(raw.ownerId),
      holderRef: str(raw.holderId) ?? str(raw.custody),
      location: str(raw.location),
      containerItemId: null,
      equipped: false,
      attuned: null,
      stateNote: str(raw.lastKnownInteraction),
      attributes: raw,
      sourceRef: src,
    });
    mapping[src] = id;
  });

  // --- Profil lika: sve što Faza 1 još ne modelira, sačuvano doslovno.
  const profileKeys = Object.keys(character).filter((k) => !["hp", "maxHp", "temporaryHp", "resources", "currency", "equipment", "externalItems"].includes(k));
  const profile = { characterId: pcId, data: Object.fromEntries(profileKeys.map((k) => [k, character[k]])), sourceRef: "state/character.json" };

  // --- Legacy događaji (doslovno, s hashom retka).
  const legacyEvents: LegacyEventRow[] = [];
  const eventLines = readText(copyRoot, "events/events.jsonl").split(/\r?\n/);
  const seen = new Set<string>();
  eventLines.forEach((line, idx) => {
    if (!line.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      findings.push({ code: "jsonl_invalid", severity: "error", message: "Neispravan JSON redak.", source: `events/events.jsonl:${idx + 1}` });
      return;
    }
    if (!isObj(o) || !str(o.id)) {
      findings.push({ code: "event_id_missing", severity: "error", message: "Događaj bez ID-a.", source: `events/events.jsonl:${idx + 1}` });
      return;
    }
    const id = str(o.id)!;
    if (seen.has(id)) findings.push({ code: "event_id_duplicate", severity: "error", message: `Dupli ID događaja ${id}.`, source: `events/events.jsonl:${idx + 1}` });
    seen.add(id);
    legacyEvents.push({
      legacyId: id,
      position: legacyEvents.length,
      sessionId: str(o.sessionId),
      legacyStateVersion: int(o.stateVersion),
      type: str(o.type),
      title: str(o.title),
      rawJson: line,
      rawSha256: sha256(line),
      sourceFile: "events/events.jsonl",
      sourceLine: idx + 1,
    });
  });

  // --- Registri.
  const entities: EntityRow[] = [];
  const pushEntities = (list: unknown, kind: EntityRow["kind"], file: string, nameKey: string) => {
    if (!Array.isArray(list)) return;
    const ids = new Set<string>();
    list.forEach((raw, i) => {
      const src = `${file}#[${i}]`;
      if (!isObj(raw)) return;
      // Odnosi nemaju ID u izvoru: prirodni ključ je par (from, to).
      const natural = kind === "relationship" && str(raw.from) && str(raw.to) ? `REL:${str(raw.from)}->${str(raw.to)}` : null;
      const id = str(raw.id) ?? natural ?? `${kind.toUpperCase()}-UNNAMED-${pad(i + 1)}`;
      if (!str(raw.id) && !natural) findings.push({ code: "entity_id_generated", severity: "warning", message: `Zapis bez ID-a; dodijeljen ${id}.`, source: src });
      if (ids.has(id)) findings.push({ code: "entity_id_duplicate", severity: "error", message: `Dupli ID ${id}.`, source: src });
      ids.add(id);
      const status = typeof raw.status === "string" ? raw.status : raw.status === undefined ? null : JSON.stringify(raw.status);
      const name = natural ? `${str(raw.from)} → ${str(raw.to)}` : (str(raw[nameKey]) ?? str(raw.name) ?? id);
      entities.push({ id, kind, name, status, visibility: "player", data: raw, sourceRef: src });
    });
  };
  pushEntities(npcsFile.npcs, "npc", "npcs/npcs.json", "name");
  pushEntities(npcsFile.relationships, "relationship", "npcs/npcs.json#relationships", "name");
  pushEntities(questsFile.quests, "quest", "quests/quests.json", "title");
  findings.push({
    code: "registry_visibility_assumed",
    severity: "info",
    message: "Zapisi iz npcs/ i quests/ uvezeni su kao vidljivi igraču; DM tajne su samo u dm_private (nije uvezeno). Klasifikacija vrste znanja slijedi u Fazi 4.",
  });

  // --- Dokumenti: svaka izvorna datoteka doslovno (Markdown kao prilog, JSON/JSONL kao „other”),
  // tako da se sačuva i sve što mapiranje ne pokriva (npr. idReconciliation u npcs.json).
  const documents: DocumentRow[] = manifest.files
    .map((f) => ({
      path: f.path,
      kind: f.path.startsWith("sessions/") ? ("session" as const) : f.path.startsWith("handoff/") ? ("handoff" as const) : f.path.startsWith("world/") ? ("world" as const) : ("other" as const),
      sha256: f.sha256,
      // Doslovni sadržaj (BOM se NE uklanja), kako bi SHA-256 sadržaja iz baze odgovarao manifestu.
      content: readFileSync(path.join(copyRoot, ...f.path.split("/")), "utf8"),
    }));

  for (const d of documents) {
    if (sha256(Buffer.from(d.content, "utf8")) !== d.sha256) {
      findings.push({ code: "document_not_utf8", severity: "error", message: "Dokument nije valjan UTF-8; doslovno čuvanje nije moguće.", source: d.path });
    }
  }

  const plan: ImportPlan = {
    setup: {
      id: campaignId,
      name: str(state.campaignName) ?? campaignId,
      members: [{ actorId: opts.ownerActorId, role: "owner" }],
      characters: hp === null || hpTemp === null ? [] : [{ id: pcId, name: str(character.name) ?? pcId, hpCurrent: hp, hpMax, hpTemp }],
      resourcePools: pools,
      wallets,
    },
    legacy: { stateVersion: int(state.stateVersion), lastEventId: str(state.lastEventId) },
    profile,
    items,
    legacyEvents,
    entities,
    documents,
    mapping,
  };
  return { plan, findings };
}
