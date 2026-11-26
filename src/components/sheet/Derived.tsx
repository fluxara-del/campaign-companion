"use client";

import type { Derived } from "@/domain/derived";
import { signed } from "./ui";

type Variant = "row" | "pill" | "sense" | "skill";

/**
 * Izvedena vrijednost s objašnjenjem izračuna (otvara se klikom ili tipkovnicom, ne hoverom).
 * Varijante: `row` (redak), `pill` (saving throw), `sense` (pasivno osjetilo), `skill` (redak vještine).
 */
export function DerivedValue({
  label,
  value,
  asModifier = true,
  testId,
  variant = "row",
  compact,
}: {
  label: string;
  value: Derived;
  asModifier?: boolean;
  testId?: string;
  variant?: Variant;
  /** Zastarjelo: isto kao `variant="skill"`. */
  compact?: boolean;
}) {
  const v = compact && variant === "row" ? "skill" : variant;
  const shown = value.value === null ? "?" : asModifier ? signed(value.value) : String(value.value);
  const valueEl = (cls: string) => (
    <span className={`font-mono tabular-nums ${cls}`} data-testid={testId ? `${testId}-value` : undefined}>
      {shown}
      {value.override ? (
        <span className="ml-0.5 text-xs text-okvir" title="Ručni override">
          *
        </span>
      ) : null}
    </span>
  );
  const summary =
    v === "pill" ? (
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-full border border-okvir/60 bg-papir pl-3 pr-1">
        <span className="whitespace-nowrap text-sm font-semibold underline decoration-dotted underline-offset-2">{label}</span>
        <span className="kutijica px-2 py-0.5 text-base">{valueEl("")}</span>
      </summary>
    ) : v === "sense" ? (
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2">
        <span className="oval inline-flex h-10 w-12 items-center justify-center text-lg">{valueEl("")}</span>
        <span className="oznaka flex-1 rounded-r-full border border-l-0 border-okvir/60 py-2 pl-2">{label}</span>
      </summary>
    ) : v === "skill" ? (
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 border-b border-current/10 py-1">
        <span className="text-sm">{label}</span>
        <span className="kutijica min-w-10 px-1.5 py-0.5 text-center text-base">{valueEl("")}</span>
      </summary>
    ) : (
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        {valueEl("text-lg")}
      </summary>
    );
  return (
    <details className={v === "row" ? "rounded-md border border-current/15 bg-papir px-3 py-1" : ""} data-testid={testId}>
      {summary}
      <div className="mt-1 space-y-1 rounded-md bg-podloga/60 p-2 text-sm">
        {value.unknownBecause ? <p>Nepoznato: {value.unknownBecause}</p> : null}
        {value.parts.map((p, i) => (
          <p key={i} className="flex justify-between gap-2">
            <span>{p.label}</span>
            <span className="font-mono">{signed(p.value)}</span>
          </p>
        ))}
        {value.override ? (
          <p className="text-okvir-tamni">
            Override {value.override.value}: {value.override.reason} ({value.override.source})
          </p>
        ) : null}
      </div>
    </details>
  );
}
