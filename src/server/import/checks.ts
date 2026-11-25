import { readFileSync } from "node:fs";
import path from "node:path";
import type { Finding, ImportPlan } from "./types";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const read = (root: string, rel: string): Obj => JSON.parse(readFileSync(path.join(root, ...rel.split("/")), "utf8").replace(/^﻿/, "")) as Obj;

/** Retci Markdown tablica `| oznaka | a/b |` → [oznaka, a, b]. */
function fractionRows(md: string): { label: string; current: number; max: number; raw: string }[] {
  const out: { label: string; current: number; max: number; raw: string }[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\/\s*(\d+)\b[^|]*\|/.exec(line);
    if (m) out.push({ label: m[1]!, current: Number(m[2]), max: Number(m[3]), raw: line.trim() });
  }
  return out;
}

function poolKeyForLabel(label: string): string | null {
  const l = label.toLowerCase();
  const slot = /spell slots?[^0-9]*(\d)/.exec(l);
  if (slot) return `spell-slot-${slot[1]}`;
  if (l.includes("lay on hands")) return "lay-on-hands";
  if (l.includes("divine smite")) return "free-divine-smite";
  if (l.includes("hit dice")) return "hit-dice";
  if (l === "hp" || l === "current hp") return "hp";
  return null;
}

/**
 * Provjere dosljednosti nad kopijom izvora i planom. Ne mijenjaju plan: strukturirana polja
 * imaju prednost, a svaki nesklad s Markdownom ili referencama ide u izvještaj.
 */
export function runConsistencyChecks(copyRoot: string, plan: ImportPlan): Finding[] {
  const findings: Finding[] = [];
  const state = read(copyRoot, "state/current-state.json");
  const character = read(copyRoot, "state/character.json");
  const pc = plan.setup.characters[0];
  const poolsByKey = new Map(plan.setup.resourcePools.map((p) => [p.resourceKey.startsWith("hit-dice") ? "hit-dice" : p.resourceKey, p]));

  // 1) Markdown tablice resursa naspram strukturiranih polja.
  for (const field of ["resourceUseMarkdown", "characterSheetMarkdown"]) {
    const md = typeof character[field] === "string" ? (character[field] as string) : "";
    for (const row of fractionRows(md)) {
      const key = poolKeyForLabel(row.label);
      if (!key) continue;
      const src = `state/character.json#${field}`;
      if (key === "hp") {
        if (pc && (pc.hpCurrent !== row.current || pc.hpMax !== row.max)) {
          findings.push({ code: "markdown_mismatch", severity: "warning", message: "HP u Markdownu razlikuje se od strukturiranog polja; vrijedi strukturirano.", source: src, details: { markdown: row.raw, structured: `${pc.hpCurrent}/${pc.hpMax}` } });
        }
        continue;
      }
      const pool = poolsByKey.get(key);
      if (!pool) continue;
      if (pool.current !== row.current || pool.max !== row.max) {
        findings.push({
          code: "markdown_mismatch",
          severity: "warning",
          message: `${row.label}: Markdown ${row.current}/${row.max}, strukturirano ${pool.current ?? "?"}/${pool.max ?? "?"}; vrijedi strukturirano, Markdown je povijesni opis.`,
          source: src,
          details: { markdown: row.raw },
        });
      } else {
        findings.push({ code: "markdown_consistent", severity: "info", message: `${row.label}: Markdown i strukturirano polje se slažu (${row.current}/${row.max}).`, source: src });
      }
    }
  }

  // 2) Novac u Markdownu.
  const inv = [character.inventoryNotesMarkdown, character.characterSheetMarkdown].filter((v): v is string => typeof v === "string").join("\n");
  const personal = plan.setup.wallets.find((w) => w.purpose === "personal");
  const group = plan.setup.wallets.find((w) => w.purpose === "group_dedicated");
  const personalMd = /osobni novac[^0-9\n]*(\d+)\s*GP/i.exec(inv);
  if (personalMd && personal && personal.amountMinor !== Number(personalMd[1]) * 100) {
    findings.push({ code: "markdown_mismatch", severity: "warning", message: "Osobni novac u Markdownu razlikuje se od strukturiranog polja.", details: { markdownGp: Number(personalMd[1]), structuredCp: personal.amountMinor } });
  }
  const groupMd = /sredstva za istragu[^0-9\n]*(\d+)\s*GP/i.exec(inv);
  if (groupMd && group && group.amountMinor !== Number(groupMd[1]) * 100) {
    findings.push({ code: "markdown_mismatch", severity: "warning", message: "Namjenski fond u Markdownu razlikuje se od strukturiranog polja.", details: { markdownGp: Number(groupMd[1]), structuredCp: group.amountMinor } });
  }

  // 3) Nepoznate vrijednosti i odmor.
  const resources = isObj(character.resources) ? character.resources : {};
  if ("heroicInspiration" in resources && resources.heroicInspiration === null) {
    findings.push({ code: "unknown_preserved", severity: "info", message: "Heroic Inspiration je nepoznat i ostaje nepoznat (nije pretvoren u „nema”)." });
  }
  if (character.lastLongRestSinceAdventureStart === false) {
    findings.push({
      code: "no_confirmed_rest",
      severity: "info",
      message: "Potvrđen dugi odmor ne postoji; potrošeni resursi ostaju potrošeni i ne stvara se događaj odmora.",
    });
  }

  // 4) Verzija i posljednji događaj.
  const ids = new Set(plan.legacyEvents.map((e) => e.legacyId));
  const last = plan.legacyEvents.at(-1);
  if (plan.legacy.lastEventId && last && last.legacyId !== plan.legacy.lastEventId) {
    findings.push({ code: "last_event_mismatch", severity: "error", message: "lastEventId u stanju nije posljednji događaj u events.jsonl.", details: { state: plan.legacy.lastEventId, file: last.legacyId } });
  } else if (plan.legacy.lastEventId && !ids.has(plan.legacy.lastEventId)) {
    findings.push({ code: "last_event_missing", severity: "error", message: "lastEventId ne postoji u events.jsonl." });
  }
  const maxVersion = Math.max(...plan.legacyEvents.map((e) => e.legacyStateVersion ?? 0));
  if (plan.legacy.stateVersion !== null && plan.legacyEvents.length > 0 && maxVersion !== plan.legacy.stateVersion) {
    findings.push({ code: "state_version_mismatch", severity: "warning", message: "stateVersion stanja ne odgovara najvišoj verziji u događajima.", details: { state: plan.legacy.stateVersion, events: maxVersion } });
  }

  // 5) Reference.
  const entityIds = new Map<string, Set<string>>();
  for (const e of plan.entities) {
    if (!entityIds.has(e.kind)) entityIds.set(e.kind, new Set());
    entityIds.get(e.kind)!.add(e.id);
  }
  const npcIds = entityIds.get("npc") ?? new Set<string>();
  const questIds = entityIds.get("quest") ?? new Set<string>();
  const known = (ref: string) => ref === pc?.id || npcIds.has(ref);
  for (const q of (Array.isArray(state.activeQuestIds) ? state.activeQuestIds : []) as unknown[]) {
    if (typeof q === "string" && !questIds.has(q)) findings.push({ code: "ref_missing", severity: "warning", message: `Aktivni zadatak ${q} ne postoji u quests.json.` });
  }
  for (const listName of ["companions", "sceneParticipantIds"]) {
    for (const r of (Array.isArray(state[listName]) ? state[listName] : []) as unknown[]) {
      if (typeof r === "string" && !known(r)) findings.push({ code: "ref_missing", severity: "warning", message: `${listName}: ${r} ne postoji u registrima.` });
    }
  }
  for (const r of (Array.isArray(character.backstoryEventIds) ? character.backstoryEventIds : []) as unknown[]) {
    if (typeof r === "string" && !ids.has(r)) findings.push({ code: "ref_missing", severity: "warning", message: `backstoryEventIds: ${r} ne postoji u events.jsonl.` });
  }
  for (const npc of plan.entities.filter((e) => e.kind === "npc")) {
    const evIds = isObj(npc.data) && Array.isArray(npc.data.adventureEventIds) ? (npc.data.adventureEventIds as unknown[]) : [];
    for (const r of evIds) {
      if (typeof r === "string" && !ids.has(r)) findings.push({ code: "ref_missing", severity: "warning", message: `${npc.id}.adventureEventIds: ${r} ne postoji.` });
    }
  }
  for (const rel of plan.entities.filter((e) => e.kind === "relationship")) {
    const d = isObj(rel.data) ? rel.data : {};
    for (const ref of [d.from, d.to]) {
      if (typeof ref === "string" && !known(ref)) findings.push({ code: "ref_missing", severity: "warning", message: `Odnos ${rel.id} referencira nepoznat ID ${ref}.`, source: rel.sourceRef });
    }
  }
  for (const it of plan.items) {
    for (const ref of [it.ownerRef, it.holderRef]) {
      if (ref && !known(ref)) findings.push({ code: "ref_missing", severity: "warning", message: `Predmet „${it.name}” referencira nepoznat ID ${ref}.`, source: it.sourceRef });
    }
  }

  // 6) Handoff mora odgovarati stanju.
  const handoff = plan.documents.find((d) => d.kind === "handoff");
  if (handoff) {
    const v = /Verzija stanja:\s*(\d+)/.exec(handoff.content);
    const e = /Posljednji događaj:\s*([A-Z0-9-]+)/.exec(handoff.content);
    if ((v && Number(v[1]) !== plan.legacy.stateVersion) || (e && e[1] !== plan.legacy.lastEventId)) {
      findings.push({ code: "handoff_mismatch", severity: "warning", message: "Handoff navodi drugu verziju ili posljednji događaj od stanja.", source: handoff.path });
    }
  }

  // 7) Ciklusi spremnika.
  const byId = new Map(plan.items.map((i) => [i.id, i]));
  for (const it of plan.items) {
    const seen = new Set<string>();
    let cur: string | null = it.containerItemId;
    while (cur) {
      if (seen.has(cur) || cur === it.id) {
        findings.push({ code: "container_cycle", severity: "error", message: `Ciklus spremnika kod „${it.name}”.` });
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.containerItemId ?? null;
    }
  }

  return findings;
}
