"use client";

import { useState } from "react";
import { SaveStatus } from "./SaveStatus";
import { HpBox, SavesCard, SensesCard, SkillsCard, SummaryStrip } from "./summary";
import { AbilitiesTab, CombatTab, EquipmentTab, MagicTab, NotesTab } from "./tabs";
import { useSheet } from "./useSheet";

const TABS = [
  { id: "borba", label: "Borba" },
  { id: "oprema", label: "Oprema" },
  { id: "magija", label: "Magija" },
  { id: "sposobnosti", label: "Sposobnosti" },
  { id: "biljeske", label: "Bilješke" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * Character sheet. Desktop: gornja traka (atributi, pokazatelji, HP), ispod tri stupca —
 * saving throwovi i osjetila, vještine, radni panel s karticama. Mobitel: jedan stupac i
 * donja navigacija. Vlastiti vizualni sustav; promjena kartice ne šalje ništa poslužitelju.
 */
export function CharacterSheetApp({ campaignId, characterId }: { campaignId: string; characterId: string }) {
  const { sheet, loadError, save, submit, retry, dismiss } = useSheet(campaignId, characterId);
  const [tab, setTab] = useState<TabId>("borba");

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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1">
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
        <div className="mx-auto mt-2 max-w-7xl">
          <SaveStatus save={save} onRetry={retry} onDismiss={dismiss} />
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-3 px-4 pt-3">
        <div className="grid gap-3 xl:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <SummaryStrip sheet={sheet} submit={submit} />
          </div>
          <div className="xl:w-[26rem]">
            <HpBox sheet={sheet} submit={submit} />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[15rem_17rem_1fr]">
          <div className="space-y-3">
            <SavesCard sheet={sheet} />
            <SensesCard sheet={sheet} />
          </div>
          <SkillsCard sheet={sheet} />

          <section aria-label="Radni panel" className="order-first min-w-0 rounded-lg border border-current/20 p-3 lg:order-none">
            <nav aria-label="Kartice lika">
              <ul role="tablist" className="flex flex-wrap gap-1 border-b border-current/15 pb-2">
                {TABS.map((t) => (
                  <li key={t.id} role="presentation">
                    <button
                      role="tab"
                      type="button"
                      aria-selected={tab === t.id}
                      aria-controls={`panel-${t.id}`}
                      id={`tab-${t.id}`}
                      onClick={() => setTab(t.id)}
                      className={`min-h-11 rounded-md px-3 text-sm font-medium uppercase tracking-wide ${tab === t.id ? "bg-tinta text-pergament dark:bg-pergament dark:text-tinta" : "hover:bg-current/5"}`}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-3">
              {tab === "borba" ? <CombatTab sheet={sheet} submit={submit} /> : null}
              {tab === "oprema" ? <EquipmentTab sheet={sheet} submit={submit} /> : null}
              {tab === "magija" ? <MagicTab sheet={sheet} submit={submit} /> : null}
              {tab === "sposobnosti" ? <AbilitiesTab sheet={sheet} submit={submit} /> : null}
              {tab === "biljeske" ? <NotesTab sheet={sheet} submit={submit} /> : null}
            </div>
          </section>
        </div>
      </div>

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
