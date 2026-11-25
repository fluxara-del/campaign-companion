-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "importerVersion" TEXT NOT NULL,
    "sourceManifestJson" TEXT NOT NULL,
    "sourceManifestHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "legacyStateVersion" INTEGER,
    "legacyLastEventId" TEXT,
    "reportJson" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "ImportBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("status" IN ('trial','accepted')),
    CHECK (json_valid("sourceManifestJson")),
    CHECK (json_valid("reportJson")),
    CHECK ("legacyStateVersion" IS NULL OR "legacyStateVersion" >= 0)
);

-- CreateTable
CREATE TABLE "LegacyEvent" (
    "campaignId" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sessionId" TEXT,
    "legacyStateVersion" INTEGER,
    "type" TEXT,
    "title" TEXT,
    "rawJson" TEXT NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceLine" INTEGER NOT NULL,
    "importBatchId" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "legacyId"),
    CONSTRAINT "LegacyEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("position" >= 0),
    CHECK ("sourceLine" >= 1),
    CHECK (json_valid("rawJson")),
    CHECK (length("rawSha256") = 64)
);

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER,
    "ownerRef" TEXT,
    "holderRef" TEXT,
    "location" TEXT,
    "containerItemId" TEXT,
    "equipped" BOOLEAN,
    "attuned" BOOLEAN,
    "massLbTenths" INTEGER,
    "stateNote" TEXT,
    "attributesJson" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    CONSTRAINT "ItemInstance_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemInstance_campaignId_containerItemId_fkey" FOREIGN KEY ("campaignId", "containerItemId") REFERENCES "ItemInstance" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("quantity" IS NULL OR "quantity" >= 0),
    CHECK ("containerItemId" IS NULL OR "containerItemId" <> "id"),
    CHECK ("massLbTenths" IS NULL OR "massLbTenths" >= 0),
    CHECK (json_valid("attributesJson"))
);

-- CreateTable
CREATE TABLE "CharacterProfile" (
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "profileJson" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "characterId"),
    CONSTRAINT "CharacterProfile_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (json_valid("profileJson"))
);

-- CreateTable
CREATE TABLE "EntityRecord" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "visibility" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "kind", "id"),
    CONSTRAINT "EntityRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('npc','quest','relationship')),
    CHECK ("visibility" IN ('player','dm','shared')),
    CHECK (json_valid("dataJson"))
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "campaignId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "path"),
    CONSTRAINT "SourceDocument_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('session','handoff','world','other')),
    CHECK (length("sha256") = 64)
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_campaignId_id_key" ON "ImportBatch"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyEvent_campaignId_position_key" ON "LegacyEvent"("campaignId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ItemInstance_campaignId_id_key" ON "ItemInstance"("campaignId", "id");

-- kdz: faza 2 — uvezeni izvori, legacy događaji i zapisi uvoza su append-only
CREATE TRIGGER "ImportBatch_no_update" BEFORE UPDATE ON "ImportBatch"
BEGIN
    SELECT RAISE(ABORT, 'ImportBatch je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "ImportBatch_no_delete" BEFORE DELETE ON "ImportBatch"
BEGIN
    SELECT RAISE(ABORT, 'ImportBatch je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "LegacyEvent_no_update" BEFORE UPDATE ON "LegacyEvent"
BEGIN
    SELECT RAISE(ABORT, 'LegacyEvent je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "LegacyEvent_no_delete" BEFORE DELETE ON "LegacyEvent"
BEGIN
    SELECT RAISE(ABORT, 'LegacyEvent je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "SourceDocument_no_update" BEFORE UPDATE ON "SourceDocument"
BEGIN
    SELECT RAISE(ABORT, 'SourceDocument je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "SourceDocument_no_delete" BEFORE DELETE ON "SourceDocument"
BEGIN
    SELECT RAISE(ABORT, 'SourceDocument je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "ItemInstance_immutable_identity" BEFORE UPDATE OF "id", "campaignId" ON "ItemInstance"
BEGIN
    SELECT RAISE(ABORT, 'ItemInstance id/campaignId su nepromjenjivi');
END;

CREATE TRIGGER "EntityRecord_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "kind" ON "EntityRecord"
BEGIN
    SELECT RAISE(ABORT, 'EntityRecord id/campaignId/kind su nepromjenjivi');
END;

CREATE TRIGGER "CharacterProfile_immutable_identity" BEFORE UPDATE OF "campaignId", "characterId" ON "CharacterProfile"
BEGIN
    SELECT RAISE(ABORT, 'CharacterProfile identitet je nepromjenjiv');
END;
