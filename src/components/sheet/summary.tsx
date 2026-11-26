"use client";

import { useState, type ReactNode } from "react";
import type { Derived } from "@/domain/derived";
import { ABILITIES, type Ability } from "@/domain/state";
import type { CharacterSheet } from "@/server/store/sheet";
import { DerivedValue } from "./Derived";
import { Button, Dialog, NumberField, TextField, signed } from "./ui";
import type { CommandInput } from "./useSheet";

type Submit = (label: string, commands: CommandInput[]) => Promise<boolean>;
type Props = { sheet: CharacterSheet; submit: Submit };

export const ABILITY_HR: Record<Ability, string> = { STR: "Snaga", DEX: "Spretnost", CON: "Izdržljivost", INT: "Inteligencija", WIS: "Mudrost", CHA: "Karizma" };
const toInt = (v: string): number | null => (/^-?\d+$/.test(v.trim()) ? Number(v) : null);
const show = (d: Derived, asMod = true) => (d.value === null ? "?" : asMod ? signed(d.value) : String(d.value));

/** Okvir pokazatelja (ADR-0008): naslov gore, velika vrijednost, oznaka dolje. */
function Tile({ top, value, bottom, testId, wide }: { top: string; value: string; bottom?: string; testId?: string; wide?: boolean }) {
  return (
    <div className={`okvir flex flex-col items-center justify-between px-2 py-1.5 text-center ${wide ? "min-w-[6.5rem]" : "min-w-[5.25rem]"}`} data-testid={testId}>
      <p className="oznaka">{top}</p>
      <p className="font-mono text-3xl leading-tight tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </p>
      {bottom ? <p className="oznaka opacity-80">{bottom}</p> : <span className="h-3" />}
    </div>
  );
}

/**
 * Traka sažetka: šest atributa (naziv, modifikator u kutiji, vrijednost u ovalu; klik otvara
 * trajnu promjenu s razlogom), proficiency, brzina, inspiracija, AC i inicijativa.
 */
export function SummaryStrip({ sheet, submit }: Props) {
  const d = sheet.derived;
  const [edit, setEdit] = useState<Ability | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inspiration = sheet.resources.find((r) => r.resourceKey === "heroic-inspiration");

  const confirm = async () => {
    const n = toInt(value);
    if (n === null || n < 1 || n > 30) return setError("Vrijednost mora biti cijeli broj od 1 do 30.");
    if (!reason.trim()) return setError("Trajna promjena traži razlog.");
    if (await submit(`${edit} → ${n}`, [{ type: "SetAbilityScore", payload: { characterId: sheet.character.id, ability: edit, value: n, reason: reason.trim() } }])) setEdit(null);
  };

  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-stretch">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Atributi">
        {ABILITIES.map((a) => (
          <li key={a} data-testid={`ability-${a}`} className="pb-3">
            <button
              type="button"
              onClick={() => {
                setEdit(a);
                setValue(String(sheet.character.abilities[a] ?? ""));
                setReason("");
                setError(null);
              }}
              aria-label={`Promijeni ${ABILITY_HR[a]}`}
              className="okvir relative flex h-full w-full min-w-[5.5rem] flex-col items-center px-1 pb-5 pt-1.5 hover:brightness-95"
            >
              <span className="oznaka">{ABILITY_HR[a]}</span>
              <span className="kutijica mt-1 w-[4.25rem] py-0.5 font-mono text-3xl leading-tight tabular-nums" data-testid={`ability-${a}-mod`}>
                {signed(d.abilities[a].modifier.value)}
              </span>
              <span className="oval absolute -bottom-3 left-1/2 min-w-12 -translate-x-1/2 px-2 text-base font-semibold tabular-nums" data-testid={`ability-${a}-score`}>
                {d.abilities[a].score ?? "?"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 xl:flex-nowrap" aria-label="Pokazatelji">
        <Tile top="Proficiency" value={show(d.proficiencyBonus)} bottom="Bonus" testId="pb" wide />
        <Tile top="Hodanje" value={d.speed.value === null ? "?" : `${d.speed.value}`} bottom="Brzina (ft)" testId="speed" wide />
        <Tile
          top="Heroic"
          value={!inspiration || inspiration.current === null ? "?" : inspiration.current > 0 ? "✓" : "–"}
          bottom={!inspiration || inspiration.current === null ? "Inspiracija ?" : "Inspiracija"}
          testId="inspiration"
          wide
        />
      </div>

      <Dialog open={edit !== null} onClose={() => setEdit(null)} title={`Trajna promjena: ${edit ? ABILITY_HR[edit] : ""}`}>
        <div className="flex flex-col gap-3">
          <NumberField label="Nova vrijednost (1–30)" value={value} onChange={setValue} min={1} max={30} />
          <TextField label="Razlog" value={reason} onChange={setReason} required />
          {error ? (
            <p role="alert" className="text-sm text-okvir-tamni">
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

/** AC (štit) i inicijativa uz radni panel, kao u primjeru. */
export function CombatTiles({ sheet }: { sheet: CharacterSheet }) {
  const d = sheet.derived;
  return (
    <div className="flex flex-wrap gap-2">
      <Tile top="Inicijativa" value={show(d.initiative)} testId="initiative" wide />
      <div className="okvir flex min-w-[6.5rem] flex-col items-center px-2 py-1.5 text-center" data-testid="ac" style={{ borderRadius: "0.6rem 0.6rem 2.75rem 2.75rem" }}>
        <p className="oznaka">Oklop</p>
        <p className="font-mono text-3xl leading-tight tabular-nums" data-testid="ac-value">
          {show(d.armorClass, false)}
        </p>
        <p className="oznaka opacity-80">{d.armorClass.override ? "Klasa*" : "Klasa"}</p>
      </div>
      <div className="okvir flex min-w-[12rem] flex-1 flex-col justify-center px-3 py-1.5 text-sm" data-testid="defenses">
        <p className="oznaka">Uvjeti</p>
        <p>{sheet.conditions.length ? sheet.conditions.map((c) => c.name).join(", ") : "Nema aktivnih uvjeta"}</p>
        <p className="oznaka mt-1">Koncentracija</p>
        <p>{sheet.concentration ? sheet.concentration.spellName : "—"}</p>
      </div>
    </div>
  );
}

/** HP okvir: Liječenje / iznos / Šteta lijevo, trenutni / maks. / privremeni desno. */
export function HpBox({ sheet, submit }: Props) {
  const c = sheet.character;
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const n = toInt(amount);
  const preview = (() => {
    if (n === null || n <= 0) return null;
    const fromTemp = Math.min(c.hpTemp, n);
    return { fromTemp, hpAfterDamage: Math.max(0, c.hpCurrent - (n - fromTemp)), hpAfterHeal: c.hpMax === null ? null : Math.min(c.hpMax, c.hpCurrent + n) };
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
  const small = "min-h-11 min-w-24 rounded-md border-2 bg-papir px-3 oznaka text-xs";
  return (
    <section aria-label="Životni bodovi" className="okvir p-2">
      <div className="flex items-stretch gap-3">
        <div className="flex flex-col gap-1">
          <button type="button" onClick={() => act("heal")} className={`${small} border-ljekovito text-ljekovito hover:bg-ljekovito hover:text-white`}>
            Liječenje
          </button>
          <label htmlFor="hp-amount" className="sr-only">
            Iznos
          </label>
          <input
            id="hp-amount"
            type="number"
            inputMode="numeric"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="kutijica min-h-11 w-24 px-2 text-center text-base"
          />
          <button type="button" onClick={() => act("damage")} className={`${small} border-okvir text-okvir hover:bg-okvir hover:text-white`}>
            Šteta
          </button>
        </div>
        <div className="flex flex-1 flex-col justify-between">
          <div className="grid grid-cols-[1fr_auto_1fr_1fr] items-end gap-x-2 text-center">
            <p className="oznaka">Trenutni</p>
            <span />
            <p className="oznaka">Maks.</p>
            <p className="oznaka">Privremeni</p>
            <p className="font-mono text-4xl tabular-nums" data-testid="hp-current">
              {c.hpCurrent}
            </p>
            <p className="pb-1 font-mono text-3xl">/</p>
            <p className="font-mono text-4xl tabular-nums">{c.hpMax ?? "?"}</p>
            <p className="font-mono text-4xl tabular-nums opacity-80" data-testid="hp-temp-value">
              {c.hpTemp > 0 ? c.hpTemp : "--"}
            </p>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="oznaka">Životni bodovi</p>
            <button type="button" onClick={() => act("temp")} className="oznaka min-h-11 rounded-md border border-current/30 px-2 text-[11px] hover:bg-podloga">
              Postavi privremeni HP
            </button>
          </div>
        </div>
      </div>
      <p className="sr-only" data-testid="hp">
        {c.hpCurrent} / {c.hpMax ?? "?"}
      </p>
      <p className="sr-only" data-testid="hp-temp">
        Privremeni HP: {c.hpTemp}
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-okvir-tamni" data-testid="hp-error">
          {error}
        </p>
      ) : null}
      {preview ? (
        <p className="mt-1 text-xs" data-testid="hp-preview">
          Pregled: šteta {n} → privremeni HP upija {preview.fromTemp}, HP {c.hpCurrent} → {preview.hpAfterDamage}; liječenje {n} → HP{" "}
          {preview.hpAfterHeal === null ? "nepoznat maksimum" : `${c.hpCurrent} → ${preview.hpAfterHeal}`}.
        </p>
      ) : null}
    </section>
  );
}

function Card({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-label={title} className="okvir p-3" data-testid={testId}>
      {children}
      <p className="oznaka mt-3 text-center">{title}</p>
    </section>
  );
}

export function SavesCard({ sheet }: { sheet: CharacterSheet }) {
  const d = sheet.derived;
  return (
    <Card title="Saving throwovi">
      <div className="grid grid-cols-2 gap-2">
        {ABILITIES.map((a) => (
          <DerivedValue key={a} label={`${d.saves[a].proficient ? "●" : "○"} ${a}`} value={d.saves[a]} testId={`save-${a}`} variant="pill" />
        ))}
      </div>
      <p className="mt-2 text-center text-xs opacity-80">● proficiency · klik za izračun</p>
    </Card>
  );
}

export function SensesCard({ sheet }: { sheet: CharacterSheet }) {
  const d = sheet.derived;
  return (
    <Card title="Osjetila">
      <div className="grid gap-2">
        <DerivedValue label="Pasivna percepcija" value={d.passivePerception} asModifier={false} testId="passive-perception" variant="sense" />
        <DerivedValue label="Pasivna istraga" value={d.passiveInvestigation} asModifier={false} variant="sense" />
        <DerivedValue label="Pasivni uvid" value={d.passiveInsight} asModifier={false} variant="sense" />
      </div>
    </Card>
  );
}

export function ProficienciesCard({ sheet }: { sheet: CharacterSheet }) {
  return (
    <Card title="Značajke i obuka">
      <ul className="space-y-1 text-sm">
        {sheet.features.length === 0 ? <li>Nema zabilježenih značajki.</li> : null}
        {sheet.features.map((f) => (
          <li key={f.id} className="border-b border-current/10 pb-1">
            {f.name}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Vještine: PROF · ATR · VJEŠTINA · BONUS. */
export function SkillsCard({ sheet }: { sheet: CharacterSheet }) {
  return (
    <Card title="Vještine">
      <div className="grid grid-cols-[2rem_2.5rem_1fr] items-center gap-x-1 border-b border-current/20 pb-1" aria-hidden>
        <span className="oznaka underline">Prof.</span>
        <span className="oznaka underline">Atr.</span>
        <span className="oznaka flex justify-between underline">
          <span>Vještina</span>
          <span>Bonus</span>
        </span>
      </div>
      <ul>
        {Object.entries(sheet.derived.skills).map(([name, s]) => (
          <li key={name} className="grid grid-cols-[2rem_2.5rem_1fr] items-center gap-x-1">
            <span aria-label={s.proficiency === "none" ? "bez proficiencyja" : s.proficiency} className="text-center text-sm">
              {s.proficiency === "expertise" ? "◆" : s.proficiency === "proficient" ? "●" : "○"}
            </span>
            <span className="text-xs font-semibold opacity-80">{s.ability}</span>
            <DerivedValue label={name} value={s} testId={`skill-${name.replace(/\s/g, "-")}`} variant="skill" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
