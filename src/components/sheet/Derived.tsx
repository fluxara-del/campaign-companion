"use client";

import type { Derived } from "@/domain/derived";
import { signed } from "./ui";

/** Izvedena vrijednost s objašnjenjem izračuna (bez hovera: otvara se klikom ili tipkovnicom). */
export function DerivedValue({ label, value, asModifier = true, testId, compact = false }: { label: string; value: Derived; asModifier?: boolean; testId?: string; compact?: boolean }) {
  const shown = value.value === null ? "?" : asModifier ? signed(value.value) : String(value.value);
  return (
    <details className={`group rounded-md border border-current/15 ${compact ? "px-2 py-0.5" : "px-3 py-2"}`} data-testid={testId}>
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-3 ${compact ? "min-h-10" : "min-h-11"}`}>
        <span className="text-sm">{label}</span>
        <span className={`font-mono tabular-nums ${compact ? "text-base" : "text-lg"}`} data-testid={testId ? `${testId}-value` : undefined}>
          {shown}
          {value.override ? <span className="ml-1 text-xs text-bronca" title="Ručni override">*</span> : null}
        </span>
      </summary>
      <div className="mt-2 space-y-1 text-sm">
        {value.unknownBecause ? <p>Nepoznato: {value.unknownBecause}</p> : null}
        {value.parts.map((p, i) => (
          <p key={i} className="flex justify-between gap-2">
            <span>{p.label}</span>
            <span className="font-mono">{signed(p.value)}</span>
          </p>
        ))}
        {value.override ? (
          <p className="text-bronca">
            Override {value.override.value}: {value.override.reason} ({value.override.source})
          </p>
        ) : null}
      </div>
    </details>
  );
}
