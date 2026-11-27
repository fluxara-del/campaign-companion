import { canonicalHash } from "./canonical";
import { getOwn } from "./records";
import type { CampaignState } from "./state";

export type RestKind = "short" | "long";

export type RestPreview = {
  characterId: string;
  kind: RestKind;
  hp: { before: number; after: number } | null;
  temp: { before: number; after: number } | null;
  pools: { resourcePoolId: string; resourceKey: string; before: number | null; after: number | null }[];
  unchanged: { what: string; reason: string }[];
  hash: string;
};

/**
 * Pregled učinka odmora prema podržanim pravilima 2024 (bez promjene stanja):
 * - dugi odmor: HP na maksimum, privremeni HP na 0, Hit Dice na maksimum,
 *   resursi s obnovom `long_rest` ili `short_rest` na maksimum;
 * - kratki odmor: resursi s obnovom `short_rest` na maksimum (trošenje Hit Dice je
 *   zasebna odluka i nije dio ovog pregleda).
 * Resurs nepoznate politike obnove ili nepoznatog maksimuma ostaje nepromijenjen i
 * navodi se s razlogom. Hash pregleda veže potvrdu uz točno ono što je igrač vidio.
 */
export function previewRest(state: CampaignState, characterId: string, kind: RestKind): RestPreview | null {
  const c = getOwn(state.characters, characterId);
  if (!c) return null;
  const unchanged: RestPreview["unchanged"] = [];
  let hp: RestPreview["hp"] = null;
  let temp: RestPreview["temp"] = null;

  if (kind === "long") {
    if (c.hpMax === null) unchanged.push({ what: "HP", reason: "Maksimalni HP je nepoznat." });
    else if (c.hpCurrent !== c.hpMax) hp = { before: c.hpCurrent, after: c.hpMax };
    if (c.hpTemp !== 0) temp = { before: c.hpTemp, after: 0 };
  } else {
    unchanged.push({ what: "HP", reason: "Kratki odmor ne vraća HP bez trošenja Hit Dice (zasebna odluka)." });
  }

  const pools: RestPreview["pools"] = [];
  for (const p of Object.values(state.resourcePools)
    .filter((x) => x.characterId === characterId)
    .sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const isHitDice = p.resourceKey.startsWith("hit-dice");
    const restores = isHitDice
      ? kind === "long"
      : p.rechargePolicy === "short_rest" || (kind === "long" && p.rechargePolicy === "long_rest");
    if (!restores) {
      if (p.rechargePolicy === null && !isHitDice) unchanged.push({ what: p.resourceKey, reason: "Pravilo obnove nije poznato." });
      else if (p.rechargePolicy === "manual") unchanged.push({ what: p.resourceKey, reason: "Obnavlja se samo ručno." });
      continue;
    }
    if (p.max === null) {
      unchanged.push({ what: p.resourceKey, reason: "Maksimum resursa je nepoznat." });
      continue;
    }
    if (p.current !== p.max) pools.push({ resourcePoolId: p.id, resourceKey: p.resourceKey, before: p.current, after: p.max });
  }

  const body = { characterId, kind, hp, temp, pools, unchanged };
  return { ...body, hash: canonicalHash(body) };
}
