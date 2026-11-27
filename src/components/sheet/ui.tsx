"use client";

import { createContext, useContext, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "quiet" | "danger" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-okvir text-white hover:bg-okvir-tamni",
        variant === "quiet" && "border border-current/30 bg-papir hover:bg-podloga",
        variant === "danger" && "border-2 border-okvir bg-papir font-bold uppercase text-okvir hover:bg-okvir hover:text-white",
        className,
      )}
    />
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-md border border-current/10 bg-papir p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-okvir/30 pb-1">
        <h2 id={id} className="oznaka text-sm text-okvir">
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
        className="min-h-11 w-28 rounded-md border border-current/40 bg-papir px-3 text-base"
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
      <input id={id} value={value} required={required} onChange={(e) => onChange(e.target.value)} className="min-h-11 rounded-md border border-current/40 bg-papir px-3 text-base" />
    </label>
  );
}

/** Postoji nerazriješeni batch: otvoreni dijalozi se zatvaraju da bi „Ponovi isti zahtjev” bio dostupan. */
export const UnresolvedBatchContext = createContext(false);

/**
 * Nativni modalni dijalog: zadržava fokus unutar sebe, a pri zatvaranju vraća fokus na okidač.
 * Kad batch postane nerazriješen, dijalog se sam zatvara (modal bi inače prekrio status s ponavljanjem,
 * a njegove kontrole su zaključane).
 */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const unresolved = useContext(UnresolvedBatchContext);
  useEffect(() => {
    if (unresolved && open) onClose();
  }, [unresolved, open, onClose]);
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
      className="okvir m-auto w-[min(32rem,calc(100vw-2rem))] p-5 text-tekst backdrop:bg-black/50"
    >
      <h2 id={titleId} className="oznaka mb-4 text-base text-okvir">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

export const signed = (n: number | null) => (n === null ? "?" : n >= 0 ? `+${n}` : `${n}`);
