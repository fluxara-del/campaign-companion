"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Učitavanje sheeta i slanje naredbi kroz jedini domenski put (`POST …/batches`).
 * „Spremljeno, verzija N” prikazuje se tek nakon potvrde poslužitelja; nakon prekida veze
 * ponavlja se ISTI batch (isti batchId), pa se trošak ne može dogoditi dvaput.
 */
export function useSheet(campaignId: string, characterId: string) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const pending = useRef<PendingBatch | null>(null);
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

  const send = useCallback(
    async (batch: PendingBatch): Promise<boolean> => {
      setSave({ kind: "saving", label: batch.label });
      let res: Response;
      try {
        res = await fetch(`${base}/batches`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch.body),
        });
      } catch {
        pending.current = batch;
        setSave({ kind: "offline", label: batch.label, message: "Veza je prekinuta. Ishod nije poznat; ponovi isti zahtjev." });
        return false;
      }
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        pending.current = null;
        setSave({ kind: "saved", label: batch.label, version: body.stateVersionAfter });
        await reload();
        return true;
      }
      if (res.status === 503 && body.code === "busy") {
        pending.current = batch;
        setSave({ kind: "offline", label: batch.label, message: "Baza je zauzeta; ponovi isti zahtjev." });
        return false;
      }
      pending.current = null;
      if (res.status === 409) {
        setSave({ kind: "conflict", label: batch.label, message: body.message ?? "Stanje se promijenilo." });
        await reload();
        return false;
      }
      setSave({ kind: "rejected", label: batch.label, message: body.message ?? "Zahtjev je odbijen.", code: body.code ?? "error" });
      return false;
    },
    [base, reload],
  );

  /** Šalje jednu ili više naredbi kao jedan atomski batch. */
  const submit = useCallback(
    async (label: string, commands: CommandInput[]): Promise<boolean> => {
      if (!sheet) return false;
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
      return send({ body, label });
    },
    [campaignId, send, sheet],
  );

  /** Ponavlja isti batch nakon prekida veze (idempotentno). */
  const retry = useCallback(async () => {
    if (pending.current) return send(pending.current);
    return false;
  }, [send]);

  return { sheet, loadError, save, submit, retry, reload, dismiss: () => setSave({ kind: "idle" }) };
}
