"use client";

import { useState } from "react";
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

/** Mali okvir sažetka: oznaka gore, vrijednost u sredini, pomoćni tekst dolje. */
function Tile({ label, value, sub, testId, children }: { label: string; value: string; sub?: string; testId?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-[5.5rem] flex-col items-center justify-between rounded-lg border border-current/20 bg-current/[0.02] px-2 py-2 text-center" data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">{label}</p>
      <p className="font-mono text-2xl leading-tight tabular-nums" data-testid={testId ? `${testId}-value` : undefined}>
        {value}
      </p>
      {sub ? <p className="text-xs opacity-80">{sub}</p> : null}
      {children}
    </div>
  );
}

const show = (d: Derived, asMod = true) => (d.value === null ? "?" : asMod ? signed(d.value) : String(d.value));

/**
 * Gornja traka sažetka: šest atributa (modifikator veliko, vrijednost malo; klik otvara
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
    <>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Atributi">
        {ABILITIES.map((a) => (
          <li key={a} data-testid={`ability-${a}`}>
            <button
              type="button"
              onClick={() => {
                setEdit(a);
                setValue(String(sheet.character.abilities[a] ?? ""));
                setReason("");
                setError(null);
              }}
              aria-label={`Promijeni ${ABILITY_HR[a]}`}
              className="flex w-full flex-col items-center rounded-lg border border-current/20 px-2 py-2 hover:bg-current/5"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider opacity-80">{ABILITY_HR[a]}</span>
              <span className="font-mono text-3xl leading-tight tabular-nums" data-testid={`ability-${a}-mod`}>
                {signed(d.abilities[a].modifier.value)}
              </span>
              <span className="mt-1 rounded-full border border-current/30 px-3 text-sm tabular-nums" data-testid={`ability-${a}-score`}>
                {d.abilities[a].score ?? "?"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2" aria-label="Pokazatelji">
        <Tile label="Proficiency" value={show(d.proficiencyBonus)} sub="bonus" testId="pb" />
        <Tile label="Brzina" value={d.speed.value === null ? "?" : `${d.speed.value}`} sub="ft" testId="speed" />
        <Tile label="Inspiracija" value={!inspiration || inspiration.current === null ? "?" : inspiration.current > 0 ? "da" : "ne"} sub={!inspiration || inspiration.current === null ? "nepoznato" : "Heroic"} testId="inspiration" />
        <Tile label="Klasa oklopa" value={show(d.armorClass, false)} sub={d.armorClass.override ? "override" : "AC"} testId="ac" />
        <Tile label="Inicijativa" value={show(d.initiative)} testId="initiative" />
      </div>

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
    </>
  );
}

/** Okvir HP-a s unosom iznosa i odvojenim radnjama Liječenje / Šteta / Privremeni HP. */
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
  return (
    <section aria-label="Životni bodovi" className="rounded-lg border border-current/20 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-2">
          <Button onClick={() => act("heal")} className="min-w-24">
            Liječenje
          </Button>
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
            placeholder="Iznos"
            className="min-h-11 w-24 rounded-md border border-current/30 bg-transparent px-2 text-center text-base"
          />
          <Button variant="danger" onClick={() => act("damage")} className="min-w-24">
            Šteta
          </Button>
        </div>
        <div className="flex flex-1 items-end justify-around gap-3 text-center">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">Trenutni</p>
            <p className="font-mono text-4xl tabular-nums" data-testid="hp-current">
              {c.hpCurrent}
            </p>
          </div>
          <p className="pb-1 font-mono text-3xl opacity-60">/</p>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">Maks.</p>
            <p className="font-mono text-4xl tabular-nums">{c.hpMax ?? "?"}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">Privremeni</p>
            <p className="font-mono text-4xl tabular-nums" data-testid="hp-temp-value">
              {c.hpTemp > 0 ? c.hpTemp : "—"}
            </p>
          </div>
        </div>
      </div>
      <p className="sr-only" data-testid="hp">
        {c.hpCurrent} / {c.hpMax ?? "?"}
      </p>
      <p className="sr-only" data-testid="hp-temp">
        Privremeni HP: {c.hpTemp}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wider">Životni bodovi</p>
        <Button variant="quiet" onClick={() => act("temp")}>
          Postavi privremeni HP
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-upozorenje" data-testid="hp-error">
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-current/20 p-3">
      {children}
      <p className="mt-2 text-center text-xs font-medium uppercase tracking-wider opacity-80">{title}</p>
    </section>
  );
}

/** Saving throwovi: 2 × 3 mreža s oznakom proficiencyja (znak, ne samo boja). */
export function SavesCard({ sheet }: { sheet: CharacterSheet }) {
  const d = sheet.derived;
  return (
    <Card title="Saving throwovi">
      <div className="grid grid-cols-2 gap-2">
        {ABILITIES.map((a) => (
          <DerivedValue key={a} label={`${d.saves[a].proficient ? "● " : "○ "}${a}`} value={d.saves[a]} testId={`save-${a}`} compact />
        ))}
      </div>
    </Card>
  );
}

export function SensesCard({ sheet }: { sheet: CharacterSheet }) {
  const d = sheet.derived;
  return (
    <Card title="Osjetila">
      <div className="grid gap-2">
        <DerivedValue label="Pasivna percepcija" value={d.passivePerception} asModifier={false} testId="passive-perception" compact />
        <DerivedValue label="Pasivna istraga" value={d.passiveInvestigation} asModifier={false} compact />
        <DerivedValue label="Pasivni uvid" value={d.passiveInsight} asModifier={false} compact />
      </div>
    </Card>
  );
}

/** Vještine kao tablica: proficiency, atribut, naziv, bonus (s objašnjenjem). */
export function SkillsCard({ sheet }: { sheet: CharacterSheet }) {
  return (
    <Card title="Vještine">
      <div className="grid grid-cols-[2rem_2.75rem_1fr] items-center gap-x-1 px-1 pb-1 text-[11px] font-medium uppercase tracking-wider opacity-80" aria-hidden>
        <span>Prof.</span>
        <span>Atr.</span>
        <span>Vještina · bonus</span>
      </div>
      <ul className="grid gap-1">
        {Object.entries(sheet.derived.skills).map(([name, s]) => (
          <li key={name} className="grid grid-cols-[2rem_2.75rem_1fr] items-center gap-x-1">
            <span aria-label={s.proficiency === "none" ? "bez proficiencyja" : s.proficiency} className="text-center">
              {s.proficiency === "expertise" ? "◆" : s.proficiency === "proficient" ? "●" : "○"}
            </span>
            <span className="text-xs opacity-80">{s.ability}</span>
            <DerivedValue label={name} value={s} testId={`skill-${name.replace(/\s/g, "-")}`} compact />
          </li>
        ))}
      </ul>
    </Card>
  );
}
