/**
 * Sigurni pristup kolekcijama stanja (`Record<string, T>`), čiji ključevi dolaze iz ulaza.
 * Obično indeksiranje (`rec[id]`) vidi i naslijeđena svojstva (`constructor`, `toString`,
 * `__proto__`), što bi omogućilo da nepostojeći ID „postoji” ili da se izmijeni zajednički
 * prototip. Svi domenski dohvati i upisi po ID-u idu isključivo kroz ove funkcije.
 */
export function getOwn<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** Postavlja vlastito svojstvo bez poziva settera (`__proto__` ne mijenja prototip). */
export function setOwn<T>(rec: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(rec, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Ključevi koji se nikad ne prihvaćaju kao ID entiteta. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(["__proto__", "prototype", "constructor"]);
