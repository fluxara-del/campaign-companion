export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-5 py-12">
      <p className="text-sm font-medium uppercase tracking-widest text-bronca">Faza 0 · temelji</p>
      <h1 className="font-serif text-4xl leading-tight">Kronike Devet Zvona</h1>
      <p className="text-lg leading-relaxed">
        Campaign Companion je u pripremi. Lik, dnevnik i AI Dungeon Master dolaze u sljedećim fazama, nakon
        odobrenja.
      </p>
      <p className="rounded-md border border-current/20 p-4 text-sm leading-relaxed">
        Postojeći podaci kampanje ostaju autoritativni dok se migracija ne potvrdi. Ova verzija ne čita niti
        mijenja podatke kampanje.
      </p>
    </main>
  );
}
