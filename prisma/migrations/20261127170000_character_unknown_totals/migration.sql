-- Faza 3a (Codex P1 na 5513d9a): zbrojevi koje izvor izričito navodi kao nepoznate.
-- Nedestruktivno: samo novi stupac s defaultom; postojeći redovi dobivaju "[]".
ALTER TABLE "Character" ADD COLUMN "unknownTotalsJson" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("unknownTotalsJson") AND json_type("unknownTotalsJson") = 'array');
