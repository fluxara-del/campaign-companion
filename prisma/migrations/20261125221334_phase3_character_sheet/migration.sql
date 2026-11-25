-- CreateTable
CREATE TABLE "StatModifier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "StatModifier_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('bonus','override')),
    CHECK (length("target") > 0 AND length("reason") > 0)
);

-- CreateTable
CREATE TABLE "SpellSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spellLevel" INTEGER,
    "known" BOOLEAN NOT NULL DEFAULT true,
    "prepared" BOOLEAN NOT NULL DEFAULT false,
    "alwaysPrepared" BOOLEAN NOT NULL DEFAULT false,
    "concentration" BOOLEAN,
    "sourceRef" TEXT,
    CONSTRAINT "SpellSelection_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("spellLevel" IS NULL OR "spellLevel" BETWEEN 0 AND 9),
    CHECK (NOT ("alwaysPrepared" AND NOT "prepared"))
);

-- CreateTable
CREATE TABLE "FeatureInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "resourcePoolId" TEXT,
    "note" TEXT,
    "sourceRef" TEXT,
    CONSTRAINT "FeatureInstance_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IS NULL OR "kind" IN ('passive','active'))
);

-- CreateTable
CREATE TABLE "ActiveCondition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "durationNote" TEXT,
    CONSTRAINT "ActiveCondition_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Concentration" (
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "spellSelectionId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "characterId"),
    CONSTRAINT "Concentration_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Concentration_campaignId_spellSelectionId_fkey" FOREIGN KEY ("campaignId", "spellSelectionId") REFERENCES "SpellSelection" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RollRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dc" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "total" INTEGER,
    "outcome" TEXT,
    "concentrationInstanceId" TEXT,
    CONSTRAINT "RollRequest_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('concentration_save')),
    CHECK ("dc" BETWEEN 1 AND 40),
    CHECK ("status" IN ('pending','resolved','cancelled')),
    CHECK (("status" = 'resolved') = ("total" IS NOT NULL)),
    CHECK ("kind" <> 'concentration_save' OR "concentrationInstanceId" IS NOT NULL)
);

-- kdz: faza 3 — aditivni stupci lika (bez redefinicije tablice)
ALTER TABLE "Character" ADD COLUMN "level" INTEGER CHECK ("level" IS NULL OR "level" BETWEEN 1 AND 20);
ALTER TABLE "Character" ADD COLUMN "speedFt" INTEGER CHECK ("speedFt" IS NULL OR "speedFt" >= 0);
ALTER TABLE "Character" ADD COLUMN "acBase" INTEGER CHECK ("acBase" IS NULL OR "acBase" BETWEEN 0 AND 40);
ALTER TABLE "Character" ADD COLUMN "spellcastingAbility" TEXT CHECK ("spellcastingAbility" IS NULL OR "spellcastingAbility" IN ('STR','DEX','CON','INT','WIS','CHA'));
ALTER TABLE "Character" ADD COLUMN "abStr" INTEGER CHECK ("abStr" IS NULL OR "abStr" BETWEEN 1 AND 30);
ALTER TABLE "Character" ADD COLUMN "abDex" INTEGER CHECK ("abDex" IS NULL OR "abDex" BETWEEN 1 AND 30);
ALTER TABLE "Character" ADD COLUMN "abCon" INTEGER CHECK ("abCon" IS NULL OR "abCon" BETWEEN 1 AND 30);
ALTER TABLE "Character" ADD COLUMN "abInt" INTEGER CHECK ("abInt" IS NULL OR "abInt" BETWEEN 1 AND 30);
ALTER TABLE "Character" ADD COLUMN "abWis" INTEGER CHECK ("abWis" IS NULL OR "abWis" BETWEEN 1 AND 30);
ALTER TABLE "Character" ADD COLUMN "abCha" INTEGER CHECK ("abCha" IS NULL OR "abCha" BETWEEN 1 AND 30);
ALTER TABLE "Character" ADD COLUMN "saveProficienciesJson" TEXT NOT NULL DEFAULT '[]' CHECK (json_valid("saveProficienciesJson") AND json_type("saveProficienciesJson") = 'array');
ALTER TABLE "Character" ADD COLUMN "skillProficienciesJson" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("skillProficienciesJson") AND json_type("skillProficienciesJson") = 'object');

-- CreateIndex
CREATE UNIQUE INDEX "StatModifier_campaignId_id_key" ON "StatModifier"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SpellSelection_campaignId_id_key" ON "SpellSelection"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureInstance_campaignId_id_key" ON "FeatureInstance"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveCondition_campaignId_id_key" ON "ActiveCondition"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RollRequest_campaignId_id_key" ON "RollRequest"("campaignId", "id");

CREATE TRIGGER "StatModifier_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "characterId" ON "StatModifier"
BEGIN
    SELECT RAISE(ABORT, 'StatModifier identitet je nepromjenjiv');
END;

CREATE TRIGGER "SpellSelection_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "characterId" ON "SpellSelection"
BEGIN
    SELECT RAISE(ABORT, 'SpellSelection identitet je nepromjenjiv');
END;

CREATE TRIGGER "FeatureInstance_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "characterId" ON "FeatureInstance"
BEGIN
    SELECT RAISE(ABORT, 'FeatureInstance identitet je nepromjenjiv');
END;

CREATE TRIGGER "ActiveCondition_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "characterId" ON "ActiveCondition"
BEGIN
    SELECT RAISE(ABORT, 'ActiveCondition identitet je nepromjenjiv');
END;

CREATE TRIGGER "RollRequest_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "characterId", "kind", "dc", "concentrationInstanceId" ON "RollRequest"
BEGIN
    SELECT RAISE(ABORT, 'RollRequest identitet je nepromjenjiv');
END;

CREATE TRIGGER "RollRequest_resolved_final" BEFORE UPDATE ON "RollRequest"
WHEN OLD."status" <> 'pending'
BEGIN
    SELECT RAISE(ABORT, 'Riješen ili poništen zahtjev za bacanje je nepromjenjiv');
END;

CREATE TRIGGER "FeatureInstance_pool_same_character_ins" BEFORE INSERT ON "FeatureInstance"
WHEN NEW."resourcePoolId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ResourcePool" p WHERE p."id" = NEW."resourcePoolId" AND p."campaignId" = NEW."campaignId" AND p."characterId" = NEW."characterId")
BEGIN
    SELECT RAISE(ABORT, 'Resurs značajke mora pripadati istom liku');
END;

CREATE TRIGGER "FeatureInstance_pool_same_character_upd" BEFORE UPDATE OF "resourcePoolId" ON "FeatureInstance"
WHEN NEW."resourcePoolId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ResourcePool" p WHERE p."id" = NEW."resourcePoolId" AND p."campaignId" = NEW."campaignId" AND p."characterId" = NEW."characterId")
BEGIN
    SELECT RAISE(ABORT, 'Resurs značajke mora pripadati istom liku');
END;

CREATE TRIGGER "Concentration_spell_same_character" BEFORE INSERT ON "Concentration"
WHEN NOT EXISTS (
    SELECT 1 FROM "SpellSelection" sp WHERE sp."id" = NEW."spellSelectionId" AND sp."campaignId" = NEW."campaignId" AND sp."characterId" = NEW."characterId")
BEGIN
    SELECT RAISE(ABORT, 'Koncentracija mora biti na čaroliji istog lika');
END;

CREATE TRIGGER "Concentration_no_update" BEFORE UPDATE ON "Concentration"
BEGIN
    SELECT RAISE(ABORT, 'Koncentracija se ne mijenja; završava se i započinje nova');
END;
