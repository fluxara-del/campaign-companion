import { CampaignList } from "@/components/home/CampaignList";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-5 py-12">
      <p className="text-sm font-medium uppercase tracking-widest text-bronca">Campaign Companion</p>
      <h1 className="font-serif text-4xl leading-tight">Kronike Devet Zvona</h1>
      <p className="text-lg leading-relaxed">Odaberi lika. Igra i dnevnik dolaze u sljedećim fazama.</p>
      <CampaignList />
      <p className="rounded-md border border-current/20 p-4 text-sm leading-relaxed">
        Postojeći podaci kampanje ostaju autoritativni dok se migracija ne potvrdi. Aplikacija radi samo lokalno (bez prijave) dok se ne odluči način prijave.
      </p>
    </main>
  );
}
