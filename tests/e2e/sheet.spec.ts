import { expect, test, type Page, type TestInfo } from "@playwright/test";

/** Svaki test ima vlastitu sintetičku kampanju (po projektu), pa su testovi neovisni. */
function campaign(info: TestInfo, n: number) {
  const id = `E2E-${info.project.name}-${String(n).padStart(2, "0")}`;
  return { id, pc: `${id}-PC` };
}

async function open(page: Page, info: TestInfo, n: number) {
  const c = campaign(info, n);
  await page.goto(`/kampanja/${c.id}/lik/${c.pc}`);
  await expect(page.getByRole("heading", { level: 1, name: "Demo Paladin" })).toBeVisible();
  return c;
}

async function tab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
}

async function expectSaved(page: Page, version: number) {
  const status = page.getByTestId("save-status");
  await expect(status).toHaveAttribute("data-state", "saved");
  await expect(status).toContainText(`Spremljeno, verzija ${version}`);
  await expect(page.getByTestId("state-version")).toHaveText(`Verzija ${version}`);
}

test("promjena atributa preračunava izvedene vrijednosti", async ({ page }, info) => {
  await open(page, info, 1);
  await expect(page.getByTestId("ability-CHA-mod")).toHaveText("+2");
  await page.getByRole("button", { name: "Promijeni Karizma" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nova vrijednost (1–30)").fill("16");
  await dialog.getByLabel(/Razlog/).fill("Ability Score Improvement");
  await dialog.getByRole("button", { name: "Spremi promjenu" }).click();
  await expectSaved(page, 1);
  await expect(page.getByTestId("ability-CHA-mod")).toHaveText("+3");
  await tab(page, "Magija");
  await expect(page.getByTestId("spell-dc-value")).toHaveText("13");
  await expect(page.getByTestId("save-CHA-value")).toHaveText("+5");
});

test("šteta prvo troši privremeni HP; liječenje ima granicu", async ({ page }, info) => {
  await open(page, info, 2);
  await tab(page, "Borba");
  const amount = page.locator("#hp-amount");
  await amount.fill("5");
  await page.getByRole("button", { name: "Postavi privremeni HP" }).click();
  await expectSaved(page, 1);
  await expect(page.getByTestId("hp-temp")).toHaveText("Privremeni HP: 5");
  await amount.fill("8");
  await expect(page.getByTestId("hp-preview")).toContainText("privremeni HP upija 5, HP 22 → 19");
  await page.getByRole("button", { name: "Šteta" }).click();
  await expectSaved(page, 2);
  await expect(page.getByTestId("hp")).toHaveText("19 / 22");
  await expect(page.getByTestId("hp-temp")).toHaveText("Privremeni HP: 0");
  await amount.fill("50");
  await page.getByRole("button", { name: "Liječenje" }).click();
  await expectSaved(page, 3);
  await expect(page.getByTestId("hp")).toHaveText("22 / 22");
});

test("nevaljani unos se odbija bez upisa", async ({ page }, info) => {
  await open(page, info, 3);
  await tab(page, "Borba");
  await page.locator("#hp-amount").fill("0");
  await page.getByRole("button", { name: "Šteta" }).click();
  await expect(page.getByTestId("hp-error")).toBeVisible();
    await page.getByRole("button", { name: "Promijeni Snaga" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nova vrijednost (1–30)").fill("31");
  await dialog.getByLabel(/Razlog/).fill("x");
  await dialog.getByRole("button", { name: "Spremi promjenu" }).click();
  await expect(dialog.getByRole("alert")).toContainText("od 1 do 30");
  await dialog.getByRole("button", { name: "Odustani" }).click();
  await expect(page.getByTestId("state-version")).toHaveText("Verzija 0");
});

test("potrošnja zadnjeg resursa", async ({ page }, info) => {
  await open(page, info, 4);
  await tab(page, "Sposobnosti");
  const row = page.getByTestId("resource-free-divine-smite");
  await row.getByRole("button", { name: "Potroši 1" }).click();
  await expectSaved(page, 1);
  await expect(page.getByTestId("resource-free-divine-smite-value")).toHaveText("0 / 1");
  await expect(row.getByRole("button", { name: "Potroši 1" })).toBeDisabled();
  await expect(page.getByTestId("resource-heroic-inspiration-value")).toHaveText("nepoznato / ?");
});

test("oprema iz spremnika: izvadi pa opremi", async ({ page }, info) => {
  const c = await open(page, info, 5);
  await tab(page, "Oprema");
  const dagger = page.getByTestId(`item-${c.pc}:item:dagger`);
  await expect(dagger.getByRole("button", { name: "Opremi" })).toHaveCount(0);
  await dagger.getByLabel("Odredište za Bodež").selectOption({ label: "Kod: Demo Paladin" });
  await dagger.getByRole("button", { name: "Premjesti" }).click();
  await expectSaved(page, 1);
  const moved = page.getByTestId(`item-${c.pc}:item:dagger`);
  await moved.getByRole("button", { name: "Opremi" }).click();
  await expectSaved(page, 2);
  await expect(page.getByTestId(`item-${c.pc}:item:dagger`)).toContainText("(opremljeno)");
});

test("premjesti predmet u ruksak (ID spremnika s dvotočkama)", async ({ page }, info) => {
  const c = await open(page, info, 14);
  await tab(page, "Oprema");
  const sword = page.getByTestId(`item-${c.pc}:item:sword`);
  await sword.getByLabel("Odredište za Mač").selectOption({ label: "U spremnik: Ruksak" });
  await sword.getByRole("button", { name: "Premjesti" }).click();
  await expectSaved(page, 1);
  const pack = page.getByTestId(`item-${c.pc}:item:pack`);
  await expect(pack.getByTestId(`item-${c.pc}:item:sword`)).toContainText("(u spremniku)");
});

test("transfer predmeta NPC-u (spremnik nosi sadržaj)", async ({ page }, info) => {
  const c = await open(page, info, 6);
  await tab(page, "Oprema");
  const pack = page.getByTestId(`item-${c.pc}:item:pack`).first();
  const select = pack.getByLabel("Odredište za Ruksak");
  // Lokalni korisnik je vlasnik (DM solo kampanje) pa vidi i DM-only NPC-a; skrivanje od igrača/viewera pokrivaju domenski testovi.
  await expect(select.locator("option", { hasText: "Tajni zlikovac" })).toHaveCount(1);
  await select.selectOption({ label: "Kod: Mara (suputnica)" });
  await pack.getByRole("button", { name: "Premjesti" }).first().click();
  await expectSaved(page, 1);
  await expect(page.getByTestId(`item-${c.pc}:item:pack`)).toHaveCount(0);
  await expect(page.getByTestId(`item-${c.pc}:item:dagger`)).toHaveCount(0);
});

test("priprema čarolije", async ({ page }, info) => {
  const c = await open(page, info, 7);
  await tab(page, "Magija");
  const cure = page.getByTestId(`spell-${c.pc}:spell:cure-wounds`);
  await expect(cure).toContainText("(nije pripremljena)");
  await cure.getByRole("button", { name: "Pripremi" }).click();
  await expectSaved(page, 1);
  await expect(page.getByTestId(`spell-${c.pc}:spell:cure-wounds`)).toContainText("(pripremljena)");
});

test("bacanje s odabranim troškom i concentration save", async ({ page }, info) => {
  const c = await open(page, info, 8);
  await tab(page, "Magija");
  await page.getByTestId(`spell-${c.pc}:spell:bless`).getByRole("button", { name: "Baci" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/Slot razine 1/).check();
  await dialog.getByRole("button", { name: "Potvrdi bacanje" }).click();
  await expectSaved(page, 1);
  await expect(page.getByTestId("pool-spell-slot-1")).toContainText("1 / 2");
  await expect(page.getByTestId("header-hp").locator("..")).toContainText("Koncentracija: Bless");
  await tab(page, "Borba");
  await page.locator("#hp-amount").fill("4");
  await page.getByRole("button", { name: "Šteta" }).click();
  await expectSaved(page, 2);
  const pending = page.getByTestId("pending-roll");
  await expect(pending).toContainText("DC 10");
  await pending.getByLabel("Rezultat bacanja").fill("15");
  await pending.getByRole("button", { name: "Upiši rezultat" }).click();
  await expectSaved(page, 3);
  await expect(page.getByTestId("pending-roll")).toHaveCount(0);
  await expect(page.getByTestId("concentration")).toContainText("Bless");
});

test("pregled i potvrda dugog odmora", async ({ page }, info) => {
  await open(page, info, 9);
  await tab(page, "Sposobnosti");
  await page.getByTestId("resource-spell-slot-1").getByRole("button", { name: "Potroši 1" }).click();
  await expectSaved(page, 1);
  await page.getByRole("button", { name: "Dugi odmor…" }).click();
  const preview = page.getByTestId("rest-preview");
  await expect(preview).toContainText("spell-slot-1: 1 → 2");
  await expect(preview).toContainText("lay-on-hands: Pravilo obnove nije poznato.");
  await page.getByRole("button", { name: "Potvrdi odmor" }).click();
  await expectSaved(page, 2);
  await expect(page.getByTestId("resource-spell-slot-1-value")).toHaveText("2 / 2");
});

test("ulazak u kartice i otvaranje objašnjenja ne šalju nijednu promjenu", async ({ page }, info) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") posts.push(r.url());
  });
  await open(page, info, 10);
  for (const name of ["Borba", "Oprema", "Magija", "Sposobnosti", "Bilješke", "Borba"]) await tab(page, name);
  await page.getByTestId("save-WIS").locator("summary").click();
  await expect(page.getByTestId("save-WIS")).toContainText("Proficiency");
  expect(posts).toEqual([]);
  await expect(page.getByTestId("state-version")).toHaveText("Verzija 0");
});

test("konflikt: zastarjela verzija prikazuje konflikt i aktualno stanje", async ({ page }, info) => {
  const c = await open(page, info, 11);
  // Druga promjena (npr. s drugog uređaja) mijenja verziju dok je sheet otvoren.
  const res = await page.request.post(`/api/campaigns/${c.id}/batches`, {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      schemaVersion: 1,
      batchId: crypto.randomUUID(),
      campaignId: c.id,
      expectedStateVersion: 0,
      commands: [{ commandId: crypto.randomUUID(), type: "ApplyDamage", intentRef: { kind: "player_choice", messageId: "e2e" }, payload: { characterId: c.pc, amount: 2, damageType: null } }],
    },
  });
  expect(res.ok()).toBe(true);
  await tab(page, "Borba");
  await page.locator("#hp-amount").fill("3");
  await page.getByRole("button", { name: "Šteta" }).click();
  const status = page.getByTestId("save-status");
  await expect(status).toHaveAttribute("data-state", "conflict");
  await expect(page.getByTestId("hp")).toHaveText("20 / 22");
  await expect(page.getByTestId("state-version")).toHaveText("Verzija 1");
});

test("tipkovnica: kartica, unos i radnja bez miša", async ({ page }, info) => {
  await open(page, info, 12);
  const borba = page.getByRole("tab", { name: "Borba" });
  await borba.focus();
  await page.keyboard.press("Enter");
  await expect(borba).toHaveAttribute("aria-selected", "true");
  await page.locator("#hp-amount").focus();
  await page.keyboard.type("6");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Šteta" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectSaved(page, 1);
  await expect(page.getByTestId("hp")).toHaveText("16 / 22");
});

test("raspored: bez horizontalnog skrola; na mobitelu donja navigacija", async ({ page }, info) => {
  await open(page, info, 13);
  for (const name of ["Borba", "Oprema", "Magija", "Sposobnosti", "Bilješke"]) {
    await tab(page, name);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontalni skrol na kartici ${name}`).toBeLessThanOrEqual(0);
  }
  const bottom = page.getByRole("navigation", { name: "Glavna navigacija" });
  if (info.project.name === "mobile") await expect(bottom).toBeVisible();
  else await expect(bottom).toBeHidden();
});
