"use client";

import type { SaveState } from "./useSheet";
import { Button } from "./ui";

/** Nenametljiv live region za status upisa (spec §3: status upisa preko live regiona). */
export function SaveStatus({ save, onRetry, onDismiss }: { save: SaveState; onRetry: () => void; onDismiss: () => void }) {
  const text =
    save.kind === "idle"
      ? ""
      : save.kind === "checking"
        ? `Provjera: ${save.label}`
        : save.kind === "saving"
          ? `Spremanje: ${save.label}…`
          : save.kind === "saved"
            ? `Spremljeno, verzija ${save.version}: ${save.label}`
            : save.kind === "conflict"
              ? `Konflikt: ${save.message} Prikazano je aktualno stanje; provjeri i pokušaj ponovno.`
              : save.kind === "rejected"
                ? `Odbijeno: ${save.message}`
                : `Veza prekinuta: ${save.message}`;
  const tone =
    save.kind === "saved" ? "border-zvono" : save.kind === "conflict" || save.kind === "rejected" || save.kind === "offline" ? "border-upozorenje" : "border-current/20";
  return (
    <div className={`flex min-h-11 flex-wrap items-center gap-2 rounded-md border px-3 py-1 text-sm ${tone}`} data-testid="save-status" data-state={save.kind}>
      <p role="status" aria-live="polite" className="flex-1">
        {text || "Nema promjena na čekanju."}
      </p>
      {save.kind === "offline" ? (
        <Button variant="quiet" onClick={onRetry}>
          Ponovi isti zahtjev
        </Button>
      ) : null}
      {save.kind !== "idle" && save.kind !== "saving" && save.kind !== "checking" ? (
        <Button variant="quiet" onClick={onDismiss} aria-label="Zatvori obavijest">
          U redu
        </Button>
      ) : null}
    </div>
  );
}
