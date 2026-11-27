"use client";

import { useState } from "react";
import { SaveStatus } from "./SaveStatus";
import { CombatTiles, HpBox, ProficienciesCard, SavesCard, SensesCard, SkillsCard, SummaryStrip } from "./summary";
import { AbilitiesTab, CombatTab, EquipmentTab, MagicTab, NotesTab, RestDialog } from "./tabs";
import { UnresolvedBatchContext } from "./ui";
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
 * Character sheet prema vlasnikovu primjeru (ADR-0008): tamna traka s imenom i radnjama
 * odmora; traka atributa, pokazatelja i HP-a; ispod saving throwovi i osjetila, vještine
 * te radni panel s karticama. Mobitel: jedan stupac i donja navigacija.
 * Promjena kartice ne šalje ništa poslužitelju.
 */
export function CharacterSheetApp({ campaignId, characterId }: { campaignId: string; characterId: string }) {
  const { sheet, loadError, save, submit, retry, dismiss, blocked, unresolved } = useSheet(campaignId, characterId);
  const [tab, setTab] = useState<TabId>("borba");
  const [rest, setRest] = useState<"short" | "long" | null>(null);

  if (loadError) {
    return (
      <main className="sheet-theme mx-auto min-h-dvh max-w-2xl p-6">
        <p role="alert">{loadError}</p>
      </main>
    );
  }
  if (!sheet) {
    return (
      <main className="sheet-theme min-h-dvh p-6">
        <p role="status">Učitavanje lika…</p>
      </main>
    );
  }

  const c = sheet.character;
  const initials = c.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const headerBtn = "oznaka inline-flex min-h-11 items-center rounded-md border border-okvir px-3 text-white hover:bg-okvir";

  return (
    <UnresolvedBatchContext.Provider value={unresolved}>
    <div className="sheet-theme min-h-dvh pb-24 md:pb-6">
      <header className="bg-traka text-white shadow-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div aria-hidden className="flex h-12 w-12 items-center justify-center rounded-md border-2 border-okvir bg-black/30 font-serif text-lg">
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{c.name}</h1>
            <p className="text-xs opacity-90">
              Razina {c.level ?? "?"} · <span data-testid="header-hp">HP {c.hpCurrent}/{c.hpMax ?? "?"}</span>
              {c.hpTemp > 0 ? ` (+${c.hpTemp})` : ""}
              {sheet.concentration ? ` · Koncentracija: ${sheet.concentration.spellName}` : ""}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <fieldset disabled={blocked} className="contents">
              <button type="button" className={`${headerBtn} disabled:opacity-50`} onClick={() => setRest("short")}>
                Kratki odmor
              </button>
              <button type="button" className={`${headerBtn} disabled:opacity-50`} onClick={() => setRest("long")}>
                Dugi odmor
              </button>
            </fieldset>
            <span className="oznaka opacity-90" data-testid="state-version">
              Verzija {sheet.stateVersion}
            </span>
          </div>
        </div>
      </header>
      {/* Status upisa ostaje vidljiv pri skrolanju (na mobitelu i uz sažetak HP-a). */}
      <div className="sticky top-0 z-10 bg-papir/95 text-tekst shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-1">
          <span className="oznaka shrink-0 md:hidden" aria-hidden>
            HP {c.hpCurrent}/{c.hpMax ?? "?"}
          </span>
          <div className="min-w-0 flex-1">
            <SaveStatus save={save} onRetry={retry} onDismiss={dismiss} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-3 px-4 pt-3">
        {/* Dok prethodni batch nije razriješen, radnje su zaključane (ponavlja se isti batch u statusu). */}
        <fieldset disabled={blocked} data-testid="sheet-actions" aria-describedby={unresolved ? "unresolved-note" : undefined} className="flex min-w-0 flex-col gap-3 xl:flex-row">
          <div className="flex-1">
            <SummaryStrip sheet={sheet} submit={submit} />
          </div>
          <div className="xl:w-[24rem] xl:shrink-0">
            <HpBox sheet={sheet} submit={submit} />
          </div>
        </fieldset>
        {unresolved ? (
          <p id="unresolved-note" className="text-sm text-okvir-tamni">
            Radnje su zaključane dok se ne ponovi prethodni zahtjev („Ponovi isti zahtjev”).
          </p>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[17rem_17rem_1fr]">
          <div className="space-y-3">
            <SavesCard sheet={sheet} />
            <SensesCard sheet={sheet} />
            <ProficienciesCard sheet={sheet} />
          </div>
          <SkillsCard sheet={sheet} />

          <div className="order-first min-w-0 space-y-3 lg:order-none">
            <CombatTiles sheet={sheet} />
            <section aria-label="Radni panel" className="okvir min-w-0 p-3">
              <nav aria-label="Kartice lika">
                <ul role="tablist" className="flex flex-wrap gap-x-4 gap-y-1 border-b border-current/15">
                  {TABS.map((t) => (
                    <li key={t.id} role="presentation">
                      <button
                        role="tab"
                        type="button"
                        aria-selected={tab === t.id}
                        aria-controls={`panel-${t.id}`}
                        id={`tab-${t.id}`}
                        onClick={() => setTab(t.id)}
                        className={`oznaka min-h-11 border-b-[3px] px-1 text-sm ${tab === t.id ? "border-okvir text-tekst" : "border-transparent opacity-75 hover:opacity-100"}`}
                      >
                        {t.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className="pt-3">
                <fieldset disabled={blocked} className="min-w-0">
                  {tab === "borba" ? <CombatTab sheet={sheet} submit={submit} /> : null}
                  {tab === "oprema" ? <EquipmentTab sheet={sheet} submit={submit} /> : null}
                  {tab === "magija" ? <MagicTab sheet={sheet} submit={submit} /> : null}
                  {tab === "sposobnosti" ? <AbilitiesTab sheet={sheet} submit={submit} /> : null}
                  {tab === "biljeske" ? <NotesTab sheet={sheet} submit={submit} /> : null}
                </fieldset>
              </div>
            </section>
          </div>
        </div>
      </div>

      <RestDialog sheet={sheet} submit={submit} kind={rest} onClose={() => setRest(null)} />

      <nav aria-label="Glavna navigacija" className="fixed inset-x-0 bottom-0 border-t-2 border-okvir bg-traka text-white md:hidden">
        <ul className="grid grid-cols-4">
          {[
            { label: "Igra", soon: true },
            { label: "Lik", soon: false },
            { label: "Dnevnik", soon: true },
            { label: "Više", soon: true },
          ].map((n) => (
            <li key={n.label}>
              <span aria-current={n.soon ? undefined : "page"} className={`oznaka flex min-h-14 flex-col items-center justify-center text-xs ${n.soon ? "opacity-50" : "text-white"}`}>
                {n.label}
                {n.soon ? <span className="text-[9px] normal-case">uskoro</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </nav>
    </div>
    </UnresolvedBatchContext.Provider>
  );
}
