"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Row = { campaignId: string; campaignName: string; characterId: string | null; characterName: string | null };

/** Popis kampanja i likova kojima korisnik ima pristup. */
export function CampaignList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/campaigns", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.message ?? "Učitavanje nije uspjelo.");
        setRows(body.campaigns);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="rounded-md border border-current/20 p-4 text-sm">{error}</p>;
  if (!rows) return <p role="status">Učitavanje…</p>;
  if (rows.length === 0) return <p className="text-sm">Nema kampanja. Pokreni probni uvoz ili demo podatke (README).</p>;
  return (
    <ul className="space-y-2">
      {rows
        .filter((r) => r.characterId)
        .map((r) => (
          <li key={`${r.campaignId}/${r.characterId}`}>
            <Link
              href={`/kampanja/${encodeURIComponent(r.campaignId)}/lik/${encodeURIComponent(r.characterId!)}`}
              className="flex min-h-11 items-center justify-between rounded-md border border-current/20 px-4 py-2 hover:bg-current/5"
            >
              <span>
                <strong>{r.characterName}</strong> · {r.campaignName}
              </span>
              <span aria-hidden>→</span>
            </Link>
          </li>
        ))}
    </ul>
  );
}
