"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BatchCommand } from "@/domain/commands";
import type { CharacterSheet } from "@/server/store/sheet";

/** Stanja upisa iz specifikacije §4: Nacrt → Provjera → Spremanje → Spremljeno, ili Konflikt / Odbijeno / Veza prekinuta. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "checking"; label: string }
  | { kind: "saving"; label: string }
  | { kind: "saved"; label: string; version: number }
  | { kind: "conflict"; label: string; message: string }
  | { kind: "rejected"; label: string; message: string; code: string }
  | { kind: "offline"; label: string; message: string };

export type CommandInput = { type: BatchCommand["type"]; payload: unknown; intent?: "player_choice" | "roll_result" };

type PendingBatch = { body: Record<string, unknown>; label: string };

const uuid = () => crypto.randomUUID();

/** Ishod jednog slanja batcha; „unknown” znači da potvrda nije pročitana pa se smije ponoviti samo isti batch. */
export type PostOutcome =
  | { kind: "saved"; version: number }
  | { kind: "unknown" }
  | { kind: "busy" }
  | { kind: "conflict"; message: string }
  | { kind: "rejected"; message: string; code: string };

const versionOf = (b: unknown): number | null => {
  const v = b && typeof b === "object" ? (b as { stateVersionAfter?: unknown }).stateVersionAfter : undefined;
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
};

/**
 * Šalje batch i tumači odgovor. Uspjeh se prijavljuje tek kad je potvrda pročitana: ako je odgovor 2xx,
 * ali tijelo nije čitljivo ili nema verzije, potvrda se dohvaća s `GET …/batches/:batchId`; ako ni to ne
 * uspije, ishod je nepoznat (ne „spremljeno”), a pozivatelj zadržava isti batch za ponavljanje.
 */
export async function postBatch(base: string, body: Record<string, unknown>, fetchImpl: typeof fetch = fetch): Promise<PostOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}/batches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { kind: "unknown" };
  }
  const parsed: unknown = await res.json().catch(() => null);
  const data = (parsed && typeof parsed === "object" ? parsed : {}) as { code?: string; message?: string };
  if (res.ok) {
    const v = versionOf(parsed);
    if (v !== null) return { kind: "saved", version: v };
    try {
      const r = await fetchImpl(`${base}/batches/${encodeURIComponent(String(body.batchId))}`, { cache: "no-store" });
      const receipt: unknown = r.ok ? await r.json().catch(() => null) : null;
      const rv = versionOf(receipt);
      return rv !== null ? { kind: "saved", version: rv } : { kind: "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  }
  if (res.status === 503 && data.code === "busy") return { kind: "busy" };
  if (res.status === 409) return { kind: "conflict", message: data.message ?? "Stanje se promijenilo." };
  return { kind: "rejected", message: data.message ?? "Zahtjev je odbijen.", code: data.code ?? "error" };
}

export const UNRESOLVED_MESSAGE = "Prethodni zahtjev nije razriješen. Ponovi isti zahtjev prije nove radnje.";

/**
 * Slanje batcheva bez Reacta (testira se zasebno). Dok postoji nerazriješeni batch (ishod nepoznat ili
 * baza zauzeta), nova radnja se ne šalje: najprije se mora ponoviti isti batch (isti batchId), koji
 * poslužitelj idempotentno potvrdi ili odbije. Tako nova radnja ne može prepisati ni izgubiti stari batch.
 */
export class BatchSender {
  private pending: PendingBatch | null = null;

  constructor(
    private readonly base: string,
    private readonly deps: {
      onState: (s: SaveState) => void;
      onBlocked: (blocked: boolean) => void;
      reload: () => Promise<unknown>;
      fetchImpl?: typeof fetch;
    },
  ) {}

  get unresolved(): PendingBatch | null {
    return this.pending;
  }

  private setPending(b: PendingBatch | null) {
    this.pending = b;
    this.deps.onBlocked(b !== null);
  }

  /** Nova radnja; odbija se dok postoji nerazriješeni batch. */
  async submit(batch: PendingBatch): Promise<boolean> {
    if (this.pending) {
      this.deps.onState({ kind: "offline", label: this.pending.label, message: UNRESOLVED_MESSAGE });
      return false;
    }
    return this.send(batch);
  }

  /** Ponavlja nerazriješeni batch (isti batchId). */
  async retry(): Promise<boolean> {
    return this.pending ? this.send(this.pending) : false;
  }

  private async send(batch: PendingBatch): Promise<boolean> {
    const { onState, reload, fetchImpl } = this.deps;
    onState({ kind: "saving", label: batch.label });
    const out = await postBatch(this.base, batch.body, fetchImpl ?? fetch);
    if (out.kind === "saved") {
      this.setPending(null);
      onState({ kind: "saved", label: batch.label, version: out.version });
      await reload();
      return true;
    }
    if (out.kind === "unknown" || out.kind === "busy") {
      this.setPending(batch);
      onState({
        kind: "offline",
        label: batch.label,
        message: out.kind === "busy" ? "Baza je zauzeta; ponovi isti zahtjev." : "Veza je prekinuta. Ishod nije poznat; ponovi isti zahtjev.",
      });
      return false;
    }
    this.setPending(null);
    if (out.kind === "conflict") {
      onState({ kind: "conflict", label: batch.label, message: out.message });
      await reload();
      return false;
    }
    onState({ kind: "rejected", label: batch.label, message: out.message, code: out.code });
    return false;
  }
}

/**
 * Učitavanje sheeta i slanje naredbi kroz jedini domenski put (`POST …/batches`).
 * „Spremljeno, verzija N” prikazuje se tek nakon potvrde poslužitelja; nakon prekida veze
 * ponavlja se ISTI batch (isti batchId), pa se trošak ne može dogoditi dvaput.
 */
export function useSheet(campaignId: string, characterId: string) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [blocked, setBlocked] = useState(false);
  const base = `/api/campaigns/${encodeURIComponent(campaignId)}`;

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`${base}/characters/${encodeURIComponent(characterId)}/sheet`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        setLoadError(body.message ?? "Učitavanje nije uspjelo.");
        return null;
      }
      setSheet(body as CharacterSheet);
      setLoadError(null);
      return body as CharacterSheet;
    } catch {
      setLoadError("Veza s poslužiteljem nije dostupna.");
      return null;
    }
  }, [base, characterId]);

  useEffect(() => {
    let active = true;
    fetch(`${base}/characters/${encodeURIComponent(characterId)}/sheet`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!active) return;
        if (res.ok) setSheet(body as CharacterSheet);
        else setLoadError(body.message ?? "Učitavanje nije uspjelo.");
      })
      .catch(() => active && setLoadError("Veza s poslužiteljem nije dostupna."));
    return () => {
      active = false;
    };
  }, [base, characterId]);

  const sender = useMemo(() => new BatchSender(base, { onState: setSave, onBlocked: setBlocked, reload }), [base, reload]);

  /** Šalje jednu ili više naredbi kao jedan atomski batch. */
  const submit = useCallback(
    async (label: string, commands: CommandInput[]): Promise<boolean> => {
      if (!sheet) return false;
      if (sender.unresolved) return sender.submit({ body: {}, label });
      setSave({ kind: "checking", label });
      const body = {
        schemaVersion: 1,
        batchId: uuid(),
        campaignId,
        expectedStateVersion: sheet.stateVersion,
        commands: commands.map((c) => ({
          commandId: uuid(),
          type: c.type,
          intentRef: c.intent === "roll_result" ? { kind: "roll_result", rollId: uuid() } : { kind: "player_choice", messageId: `ui-${uuid()}` },
          payload: c.payload,
        })),
      };
      return sender.submit({ body, label });
    },
    [campaignId, sender, sheet],
  );

  /** Ponavlja isti batch nakon prekida veze (idempotentno). */
  const retry = useCallback(() => sender.retry(), [sender]);

  // Obavijest o nerazriješenom batchu ne može se zatvoriti dok se batch ne ponovi.
  const dismiss = useCallback(() => {
    if (!sender.unresolved) setSave({ kind: "idle" });
  }, [sender]);

  return { sheet, loadError, save, submit, retry, reload, dismiss, blocked };
}
