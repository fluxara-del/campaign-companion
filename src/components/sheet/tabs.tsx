"use client";

import { useState } from "react";
import { ABILITIES, type Ability } from "@/domain/state";
import type { CharacterSheet, ItemNode } from "@/server/store/sheet";
import { DerivedValue } from "./Derived";
import { Button, Dialog, NumberField, Section, TextField, signed } from "./ui";
import type { CommandInput } from "./useSheet";

export type Submit = (label: string, commands: CommandInput[]) => Promise<boolean>;
type TabProps = { sheet: CharacterSheet; submit: Submit };

const ABILITY_HR: Record<Ability, string> = { STR: "Snaga", DEX: "Spretnost", CON: "Izdržljivost", INT: "Inteligencija", WIS: "Mudrost", CHA: "Karizma" };

const toInt = (v: string): number | null => (/^-?\d+$/.test(v.trim()) ? Number(v) : null);

/* ------------------------------- Pregled ------------------------------- */

export function OverviewTab({ sheet, submit }: TabProps) {
  const d = sheet.derived;
  const [edit, setEdit] = useState<Ability | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = (a: Ability) => {
    setEdit(a);
    setValue(String(sheet.character.abilities[a] ?? ""));
    setReason("");
    setError(null);
  };
  const confirm = async () => {
    const n = toInt(value);
    if (n === null || n < 1 || n > 30) return setError("Vrijednost mora biti cijeli broj od 1 do 30.");
    if (!reason.trim()) return setError("Trajna promjena traži razlog.");
    if (await submit(`${edit} → ${n}`, [{ type: "SetAbilityScore", payload: { characterId: sheet.character.id, ability: edit, value: n, reason: reason.trim() } }])) setEdit(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Atributi">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ABILITIES.map((a) => (
            <li key={a} className="rounded-md border border-current/15 p-3" data-testid={`ability-${a}`}>
              <p className="text-xs uppercase tracking-wide">{ABILITY_HR[a]}</p>
              <p className="font-mono text-2xl tabular-nums" data-testid={`ability-${a}-mod`}>
                {signed(d.abilities[a].modifier.value)}
              </p>
              <p className="text-sm">
                Vrijednost <span data-testid={`ability-${a}-score`}>{d.abilities[a].score ?? "?"}</span>
              </p>
              <Button variant="quiet" className="mt-2 w-full" onClick={() => open(a)} aria-label={`Promijeni ${ABILITY_HR[a]}`}>
                Promijeni
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs">Promjena atributa je trajna promjena lika (ne potrošnja u igri) i traži razlog.</p>
      </Section>

      <Section title="Saving throwovi">
        <div className="grid gap-2 sm:grid-cols-2">
          {ABILITIES.map((a) => (
            <DerivedValue key={a} label={`${ABILITY_HR[a]}${d.saves[a].proficient ? " (proficiency)" : ""}`} value={d.saves[a]} testId={`save-${a}`} />
          ))}
        </div>
      </Section>

      <Section title="Vještine">
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(d.skills).map(([name, s]) => (
            <DerivedValue key={name} label={`${name} (${s.ability})${s.proficiency === "expertise" ? " · expertise" : s.proficiency === "proficient" ? " · proficiency" : ""}`} value={s} testId={`skill-${name.replace(/\s/g, "-")}`} />
          ))}
        </div>
      </Section>

      <Section title="Ostalo">
        <div className="grid gap-2">
          <DerivedValue label="Proficiency bonus" value={d.proficiencyBonus} />
          <DerivedValue label="Pasivna percepcija" value={d.passivePerception} asModifier={false} testId="passive-perception" />
          <DerivedValue label="Spell save DC" value={d.spellSaveDc} asModifier={false} testId="spell-dc" />
          <DerivedValue label="Spell attack" value={d.spellAttack} testId="spell-attack" />
        </div>
        <ul className="mt-3 list-disc pl-5 text-xs">
          {d.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>

      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={`Trajna promjena: ${edit ? ABILITY_HR[edit] : ""}`}>
        <div className="flex flex-col gap-3">
          <NumberField label="Nova vrijednost (1–30)" value={value} onChange={setValue} min={1} max={30} />
          <TextField label="Razlog" value={reason} onChange={setReason} required />
          {error ? (
            <p role="alert" className="text-sm text-upozorenje">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={confirm}>Spremi promjenu</Button>
            <Button variant="quiet" onClick={() => setEdit(null)}>
              Odustani
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/* -------------------------------- Borba -------------------------------- */

export function CombatTab({ sheet, submit }: TabProps) {
  const c = sheet.character;
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [roll, setRoll] = useState("");
  const [cond, setCond] = useState({ name: "", source: "" });
  const n = toInt(amount);

  const preview = (() => {
    if (n === null || n <= 0) return null;
    const fromTemp = Math.min(c.hpTemp, n);
    const hpAfterDamage = Math.max(0, c.hpCurrent - (n - fromTemp));
    const hpAfterHeal = c.hpMax === null ? null : Math.min(c.hpMax, c.hpCurrent + n);
    return { fromTemp, hpAfterDamage, hpAfterHeal };
  })();

  const act = async (kind: "damage" | "heal" | "temp") => {
    if (n === null || n <= 0 || n > 10_000) return setError("Unesi cijeli broj veći od 0.");
    setError(null);
    const ok =
      kind === "damage"
        ? await submit(`Šteta ${n}`, [{ type: "ApplyDamage", payload: { characterId: c.id, amount: n, damageType: null } }])
        : kind === "heal"
          ? await submit(`Liječenje ${n}`, [{ type: "ApplyHealing", payload: { characterId: c.id, amount: n } }])
          : await submit(`Privremeni HP ${n}`, [{ type: "SetTemporaryHp", payload: { characterId: c.id, amount: n, mode: "replace" } }]);
    if (ok) setAmount("");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Životni bodovi (HP)">
        <p className="font-mono text-3xl tabular-nums" data-testid="hp">
          {c.hpCurrent} / {c.hpMax ?? "?"}
        </p>
        <p className="text-sm" data-testid="hp-temp">
          Privremeni HP: {c.hpTemp}
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <NumberField label="Iznos" value={amount} onChange={setAmount} min={1} id="hp-amount" />
          <Button variant="danger" onClick={() => act("damage")}>
            Šteta
          </Button>
          <Button onClick={() => act("heal")}>Liječenje</Button>
          <Button variant="quiet" onClick={() => act("temp")}>
            Postavi privremeni HP
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-upozorenje" data-testid="hp-error">
            {error}
          </p>
        ) : null}
        {preview ? (
          <p className="mt-2 text-sm" data-testid="hp-preview">
            Pregled: šteta {n} → privremeni HP upija {preview.fromTemp}, HP {c.hpCurrent} → {preview.hpAfterDamage}; liječenje {n} → HP{" "}
            {preview.hpAfterHeal === null ? "nepoznat maksimum" : `${c.hpCurrent} → ${preview.hpAfterHeal}`}.
          </p>
        ) : null}
        <p className="mt-2 text-xs">Privremeni HP se ne zbraja: novi iznos zamjenjuje postojeći.</p>
      </Section>

      <Section title="Borbeni pokazatelji">
        <div className="grid gap-2">
          <DerivedValue label="Klasa oklopa (AC)" value={sheet.derived.armorClass} asModifier={false} testId="ac" />
          <DerivedValue label="Inicijativa" value={sheet.derived.initiative} testId="initiative" />
          <DerivedValue label="Brzina (ft)" value={sheet.derived.speed} asModifier={false} />
        </div>
      </Section>

      <Section title="Koncentracija">
        {sheet.concentration ? (
          <div className="flex flex-wrap items-center gap-2">
            <p data-testid="concentration">Koncentrira: {sheet.concentration.spellName}</p>
            <Button variant="quiet" onClick={() => submit("Kraj koncentracije", [{ type: "EndConcentration", payload: { characterId: c.id, reason: "Igrač završava koncentraciju" } }])}>
              Završi koncentraciju
            </Button>
          </div>
        ) : (
          <p data-testid="concentration">Nema koncentracije.</p>
        )}
        {sheet.pendingRolls.map((r) => (
          <div key={r.id} className="mt-3 rounded-md border border-bronca p-3" data-testid="pending-roll">
            <p className="text-sm">
              {r.reason}: baci concentration save i unesi ukupni rezultat. DC {r.dc}.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <NumberField label="Rezultat bacanja" value={roll} onChange={setRoll} id={`roll-${r.id}`} />
              <Button
                onClick={async () => {
                  const t = toInt(roll);
                  if (t === null) return setError("Unesi ukupni rezultat bacanja.");
                  if (await submit(`Concentration save ${t}`, [{ type: "ResolveRollRequest", payload: { rollRequestId: r.id, total: t }, intent: "roll_result" }])) setRoll("");
                }}
              >
                Upiši rezultat
              </Button>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Uvjeti">
        <ul className="space-y-2" data-testid="conditions">
          {sheet.conditions.length === 0 ? <li className="text-sm">Nema aktivnih uvjeta.</li> : null}
          {sheet.conditions.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-current/15 p-2">
              <span>
                <strong>{x.name}</strong> · {x.source}
                {x.durationNote ? ` · ${x.durationNote}` : ""}
              </span>
              <Button variant="quiet" onClick={() => submit(`Uklanjanje ${x.name}`, [{ type: "RemoveCondition", payload: { conditionId: x.id, reason: "Ručno uklonjeno" } }])}>
                Ukloni
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <TextField label="Uvjet" value={cond.name} onChange={(v) => setCond({ ...cond, name: v })} />
          <TextField label="Izvor" value={cond.source} onChange={(v) => setCond({ ...cond, source: v })} />
          <Button
            variant="quiet"
            onClick={async () => {
              if (!cond.name.trim() || !cond.source.trim()) return setError("Uvjet i izvor su obavezni.");
              if (await submit(`Uvjet ${cond.name}`, [{ type: "ApplyCondition", payload: { characterId: c.id, name: cond.name.trim(), source: cond.source.trim(), durationNote: null } }]))
                setCond({ name: "", source: "" });
            }}
          >
            Dodaj uvjet
          </Button>
        </div>
      </Section>
    </div>
  );
}

/* -------------------------------- Oprema ------------------------------- */

function ItemRow({ item, sheet, submit, depth }: { item: ItemNode; sheet: CharacterSheet; submit: Submit; depth: number }) {
  const [target, setTarget] = useState("");
  const move = async () => {
    if (!target) return;
    const [kind, ref] = target.split(":", 2) as ["holder" | "container", string];
    const to = kind === "holder" ? { kind: "holder", holderRef: ref } : { kind: "container", containerItemId: ref };
    if (await submit(`Premještanje: ${item.name}`, [{ type: "TransferItem", payload: { itemId: item.id, to } }])) setTarget("");
  };
  return (
    <li className="rounded-md border border-current/15 p-2" style={{ marginLeft: depth * 12 }} data-testid={`item-${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>{item.name}</strong>
          {item.quantity !== null ? ` ×${item.quantity}` : " ×?"}
          {item.equipped ? <span className="ml-2 text-xs text-zvono">(opremljeno)</span> : null}
          {item.containerItemId ? <span className="ml-2 text-xs">(u spremniku)</span> : null}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {!item.containerItemId ? (
            <Button variant="quiet" onClick={() => submit(item.equipped ? `Skidanje: ${item.name}` : `Opremanje: ${item.name}`, [{ type: "SetEquipped", payload: { itemId: item.id, equipped: !item.equipped } }])}>
              {item.equipped ? "Skini" : "Opremi"}
            </Button>
          ) : null}
          <label className="flex items-center gap-1 text-sm">
            <span className="sr-only">Odredište za {item.name}</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-11 rounded-md border border-current/30 bg-transparent px-2" aria-label={`Odredište za ${item.name}`}>
              <option value="">Premjesti…</option>
              {sheet.holders.map((h) => (
                <option key={h.id} value={`holder:${h.id}`}>
                  Kod: {h.name}
                </option>
              ))}
              {sheet.containers
                .filter((x) => x.id !== item.id)
                .map((x) => (
                  <option key={x.id} value={`container:${x.id}`}>
                    U spremnik: {x.name}
                  </option>
                ))}
            </select>
          </label>
          <Button variant="quiet" onClick={move} disabled={!target}>
            Premjesti
          </Button>
        </div>
      </div>
      {item.contents.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {item.contents.map((c) => (
            <ItemRow key={c.id} item={c} sheet={sheet} submit={submit} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function EquipmentTab({ sheet, submit }: TabProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Section title="Inventar">
        {sheet.inventory.length === 0 ? <p className="text-sm">Lik trenutačno ne drži nijedan predmet.</p> : null}
        <ul className="space-y-2">
          {sheet.inventory.map((i) => (
            <ItemRow key={i.id} item={i} sheet={sheet} submit={submit} depth={0} />
          ))}
        </ul>
      </Section>
      <Section title="Novac">
        <ul className="space-y-2">
          {sheet.wallets.map((w) => (
            <li key={w.id} className="rounded-md border border-current/15 p-2" data-testid={`wallet-${w.purpose}`}>
              <p className="text-sm">
                {w.label} ({w.purpose === "personal" ? "osobni" : "namjenski grupni"})
              </p>
              <p className="font-mono text-lg">{w.amountMinor === null ? "nepoznato" : `${w.amountMinor / 100} GP`}</p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/* --------------------------------- Magija ------------------------------ */

export function MagicTab({ sheet, submit }: TabProps) {
  const [casting, setCasting] = useState<string | null>(null);
  const [cost, setCost] = useState("");
  const [details, setDetails] = useState<{ id: string; level: string; conc: string } | null>(null);
  const spell = sheet.spells.find((s) => s.id === casting) ?? null;
  const slots = sheet.resources.filter((r) => /^spell-slot-\d$/.test(r.resourceKey));
  const freeUses = sheet.resources.filter((r) => !/^spell-slot-/.test(r.resourceKey));

  const cast = async () => {
    if (!spell) return;
    const c = cost === "none" ? { kind: "none" } : cost.startsWith("slot:") ? { kind: "slot", resourcePoolId: cost.slice(5) } : { kind: "free_use", resourcePoolId: cost.slice(5) };
    if (await submit(`Bacanje: ${spell.name}`, [{ type: "ResolveCast", payload: { spellSelectionId: spell.id, cost: c } }])) setCasting(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Section title="Čarolije">
        <ul className="space-y-2">
          {sheet.spells.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-current/15 p-2" data-testid={`spell-${s.id}`}>
              <span>
                <strong>{s.name}</strong> · razina {s.spellLevel ?? "?"}
                {s.concentration ? " · koncentracija" : s.concentration === null ? " · koncentracija ?" : ""}
                <span className="ml-2 text-xs">{s.alwaysPrepared ? "(uvijek pripremljena)" : s.prepared ? "(pripremljena)" : "(nije pripremljena)"}</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {!s.alwaysPrepared ? (
                  <Button variant="quiet" onClick={() => submit(s.prepared ? `Odpripremi: ${s.name}` : `Pripremi: ${s.name}`, [{ type: "SetSpellPrepared", payload: { spellSelectionId: s.id, prepared: !s.prepared } }])}>
                    {s.prepared ? "Odpripremi" : "Pripremi"}
                  </Button>
                ) : null}
                <Button variant="quiet" onClick={() => setDetails({ id: s.id, level: s.spellLevel === null ? "" : String(s.spellLevel), conc: s.concentration === null ? "" : s.concentration ? "da" : "ne" })}>
                  Podaci
                </Button>
                <Button
                  onClick={() => {
                    setCasting(s.id);
                    setCost(s.spellLevel === 0 ? "none" : "");
                  }}
                  disabled={!s.prepared && !s.alwaysPrepared}
                >
                  Baci
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Spell slotovi">
        <ul className="space-y-2">
          {slots.map((r) => (
            <li key={r.id} className="flex justify-between rounded-md border border-current/15 p-2" data-testid={`pool-${r.resourceKey}`}>
              <span>{r.resourceKey.replace("spell-slot-", "Razina ")}</span>
              <span className="font-mono">
                {r.current ?? "?"} / {r.max ?? "?"}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Dialog open={spell !== null} onClose={() => setCasting(null)} title={`Bacanje: ${spell?.name ?? ""}`}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm">Odaberi trošak (nikad oba):</legend>
          {spell?.spellLevel === 0 ? (
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="cost" value="none" checked={cost === "none"} onChange={() => setCost("none")} /> Bez troška (cantrip)
            </label>
          ) : null}
          {slots.map((r) => (
            <label key={r.id} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="cost" value={`slot:${r.id}`} checked={cost === `slot:${r.id}`} onChange={() => setCost(`slot:${r.id}`)} />
              Slot {r.resourceKey.replace("spell-slot-", "razine ")} ({r.current ?? "?"} preostalo)
            </label>
          ))}
          {freeUses.map((r) => (
            <label key={r.id} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="cost" value={`free:${r.id}`} checked={cost === `free:${r.id}`} onChange={() => setCost(`free:${r.id}`)} />
              Besplatna uporaba: {r.resourceKey} ({r.current ?? "?"} preostalo)
            </label>
          ))}
        </fieldset>
        <div className="mt-4 flex gap-2">
          <Button onClick={cast} disabled={!cost}>
            Potvrdi bacanje
          </Button>
          <Button variant="quiet" onClick={() => setCasting(null)}>
            Odustani
          </Button>
        </div>
      </Dialog>

      <Dialog open={details !== null} onClose={() => setDetails(null)} title="Podaci čarolije">
        {details ? (
          <div className="flex flex-col gap-3">
            <NumberField label="Razina (0 = cantrip)" value={details.level} onChange={(v) => setDetails({ ...details, level: v })} min={0} max={9} />
            <label className="flex flex-col gap-1 text-sm">
              Koncentracija
              <select value={details.conc} onChange={(e) => setDetails({ ...details, conc: e.target.value })} className="min-h-11 rounded-md border border-current/30 bg-transparent px-2">
                <option value="">nepoznato</option>
                <option value="da">da</option>
                <option value="ne">ne</option>
              </select>
            </label>
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  const lvl = details.level === "" ? null : toInt(details.level);
                  const ok = await submit("Podaci čarolije", [
                    { type: "SetSpellDetails", payload: { spellSelectionId: details.id, spellLevel: lvl, concentration: details.conc === "" ? null : details.conc === "da" } },
                  ]);
                  if (ok) setDetails(null);
                }}
              >
                Spremi
              </Button>
              <Button variant="quiet" onClick={() => setDetails(null)}>
                Odustani
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/* ------------------------------ Sposobnosti ---------------------------- */

export function AbilitiesTab({ sheet, submit }: TabProps) {
  const [rest, setRest] = useState<"short" | "long" | null>(null);
  const preview = rest ? sheet.restPreview[rest] : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Resursi">
        <ul className="space-y-2">
          {sheet.resources.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-current/15 p-2" data-testid={`resource-${r.resourceKey}`}>
              <span>
                {r.resourceKey}{" "}
                <span className="font-mono" data-testid={`resource-${r.resourceKey}-value`}>
                  {r.current === null ? "nepoznato" : r.current} / {r.max ?? "?"}
                </span>
                <span className="ml-2 text-xs">obnova: {r.rechargePolicy ?? "nepoznata"}</span>
              </span>
              <Button variant="quiet" disabled={r.current === null || r.current < 1} onClick={() => submit(`Potrošnja: ${r.resourceKey}`, [{ type: "ConsumeResource", payload: { resourcePoolId: r.id, amount: 1 } }])}>
                Potroši 1
              </Button>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Značajke">
        <ul className="space-y-1">
          {sheet.features.map((f) => (
            <li key={f.id} className="text-sm">
              {f.name}
              {f.kind ? ` · ${f.kind === "active" ? "aktivna" : "pasivna"}` : ""}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Odmor">
        <p className="text-sm">Odmor obnavlja resurse samo nakon potvrde. Nova sesija ili jutro nisu odmor.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="quiet" onClick={() => setRest("short")}>
            Kratki odmor…
          </Button>
          <Button variant="quiet" onClick={() => setRest("long")}>
            Dugi odmor…
          </Button>
        </div>
      </Section>
      <Dialog open={preview !== null} onClose={() => setRest(null)} title={rest === "long" ? "Pregled dugog odmora" : "Pregled kratkog odmora"}>
        {preview ? (
          <div className="space-y-3 text-sm" data-testid="rest-preview">
            {preview.hp ? (
              <p>
                HP: {preview.hp.before} → {preview.hp.after}
              </p>
            ) : null}
            {preview.temp ? (
              <p>
                Privremeni HP: {preview.temp.before} → {preview.temp.after}
              </p>
            ) : null}
            {preview.pools.map((p) => (
              <p key={p.resourcePoolId}>
                {p.resourceKey}: {p.before ?? "?"} → {p.after ?? "?"}
              </p>
            ))}
            {preview.pools.length === 0 && !preview.hp && !preview.temp ? <p>Nema promjena.</p> : null}
            {preview.unchanged.length > 0 ? (
              <div>
                <p className="font-medium">Ne mijenja se:</p>
                <ul className="list-disc pl-5">
                  {preview.unchanged.map((u) => (
                    <li key={u.what}>
                      {u.what}: {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                onClick={async () => {
                  if (await submit(rest === "long" ? "Dugi odmor" : "Kratki odmor", [{ type: "CompleteRest", payload: { characterId: sheet.character.id, kind: rest, previewHash: preview.hash } }])) setRest(null);
                }}
              >
                Potvrdi odmor
              </Button>
              <Button variant="quiet" onClick={() => setRest(null)}>
                Odustani
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/* -------------------------------- Bilješke ----------------------------- */

export function NotesTab({ sheet, submit }: TabProps) {
  const [text, setText] = useState("");
  return (
    <Section title="Bilješke">
      <p className="mb-2 text-sm">Osobne bilješke ne mijenjaju mehaniku lika. Dnevnik kampanje dolazi u Fazi 4.</p>
      <label className="flex flex-col gap-1 text-sm">
        Nova bilješka
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="rounded-md border border-current/30 bg-transparent p-2 text-base" />
      </label>
      <Button
        className="mt-2"
        disabled={!text.trim()}
        onClick={async () => {
          if (await submit("Bilješka", [{ type: "AppendJournalNote", payload: { title: null, text: text.trim(), visibility: "player" } }])) setText("");
        }}
      >
        Spremi bilješku
      </Button>
      <p className="mt-2 text-xs">Verzija stanja: {sheet.stateVersion}</p>
    </Section>
  );
}
