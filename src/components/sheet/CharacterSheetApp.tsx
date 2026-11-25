"use client";

import { useState } from "react";
import { SaveStatus } from "./SaveStatus";
import { AbilitiesTab, CombatTab, EquipmentTab, MagicTab, NotesTab, OverviewTab } from "./tabs";
import { useSheet } from "./useSheet";

const TABS = [
  { id: "pregled", label: "Pregled" },
  { id: "borba", label: "Borba" },
  { id: "oprema", label: "Oprema" },
  { id: "magija", label: "Magija" },
  { id: "sposobnosti", label: "Sposobnosti" },
  { id: "biljeske", label: "Bilješke" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Character sheet: kompaktno zaglavlje (HP, koncentracija, status upisa), kartice i
 * donja navigacija na mobitelu. Promjena kartice ne šalje ništa poslužitelju.
 */
export function CharacterSheetApp({ campaignId, characterId }: { campaignId: string; characterId: string }) {
  const { sheet, loadError, save, submit, retry, dismiss } = useSheet(campaignId, characterId);
  const [tab, setTab] = useState<TabId>("pregled");

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="alert">{loadError}</p>
      </main>
    );
  }
  if (!sheet) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="status">Učitavanje lika…</p>
      </main>
    );
  }

  const c = sheet.character;
  return (
    <div className="min-h-dvh pb-24 md:pb-6">
      <header className="sticky top-0 z-10 border-b border-current/15 bg-[var(--background)]/95 px-4 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="font-serif text-xl">{c.name}</h1>
          <p className="text-sm">
            Razina {c.level ?? "?"} · <span data-testid="header-hp">HP {c.hpCurrent}/{c.hpMax ?? "?"}</span>
            {c.hpTemp > 0 ? ` (+${c.hpTemp})` : ""}
            {sheet.concentration ? ` · Koncentracija: ${sheet.concentration.spellName}` : ""}
          </p>
          <p className="ml-auto text-xs" data-testid="state-version">
            Verzija {sheet.stateVersion}
          </p>
        </div>
        <div className="mx-auto mt-2 max-w-6xl">
          <SaveStatus save={save} onRetry={retry} onDismiss={dismiss} />
        </div>
      </header>

      <nav aria-label="Kartice lika" className="mx-auto max-w-6xl px-4 pt-3">
        <ul role="tablist" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <li key={t.id} role="presentation">
              <button
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`min-h-11 rounded-md px-4 text-sm ${tab === t.id ? "bg-tinta text-pergament dark:bg-pergament dark:text-tinta" : "border border-current/25"}`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="mx-auto max-w-6xl px-4 py-4">
        {tab === "pregled" ? <OverviewTab sheet={sheet} submit={submit} /> : null}
        {tab === "borba" ? <CombatTab sheet={sheet} submit={submit} /> : null}
        {tab === "oprema" ? <EquipmentTab sheet={sheet} submit={submit} /> : null}
        {tab === "magija" ? <MagicTab sheet={sheet} submit={submit} /> : null}
        {tab === "sposobnosti" ? <AbilitiesTab sheet={sheet} submit={submit} /> : null}
        {tab === "biljeske" ? <NotesTab sheet={sheet} submit={submit} /> : null}
      </main>

      <nav aria-label="Glavna navigacija" className="fixed inset-x-0 bottom-0 border-t border-current/15 bg-[var(--background)] md:hidden">
        <ul className="grid grid-cols-4">
          {[
            { label: "Igra", soon: true },
            { label: "Lik", soon: false },
            { label: "Dnevnik", soon: true },
            { label: "Više", soon: true },
          ].map((n) => (
            <li key={n.label}>
              <span aria-current={n.soon ? undefined : "page"} className={`flex min-h-14 flex-col items-center justify-center text-sm ${n.soon ? "opacity-50" : "font-medium"}`}>
                {n.label}
                {n.soon ? <span className="text-[10px]">uskoro</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
