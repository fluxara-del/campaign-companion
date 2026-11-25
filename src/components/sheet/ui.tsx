"use client";

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-zvono text-white hover:bg-zvono/90",
        variant === "quiet" && "border border-current/25 hover:bg-current/5",
        variant === "danger" && "bg-upozorenje text-white hover:bg-upozorenje/90",
        className,
      )}
    />
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-lg border border-current/15 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="font-serif text-lg">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function NumberField({ label, value, onChange, min, max, id }: { label: string; value: string; onChange: (v: string) => void; min?: number; max?: number; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <input
        id={fid}
        inputMode="numeric"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-28 rounded-md border border-current/30 bg-transparent px-3 text-base"
      />
    </label>
  );
}

export function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-sm">
      <span>
        {label}
        {required ? " (obavezno)" : ""}
      </span>
      <input id={id} value={value} required={required} onChange={(e) => onChange(e.target.value)} className="min-h-11 rounded-md border border-current/30 bg-transparent px-3 text-base" />
    </label>
  );
}

/** Nativni modalni dijalog: zadržava fokus unutar sebe, a pri zatvaranju vraća fokus na okidač. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      opener.current?.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-current/20 bg-[var(--background)] p-5 text-[var(--foreground)] backdrop:bg-black/50"
    >
      <h2 id={titleId} className="mb-4 font-serif text-xl">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export const signed = (n: number | null) => (n === null ? "?" : n >= 0 ? `+${n}` : `${n}`);
