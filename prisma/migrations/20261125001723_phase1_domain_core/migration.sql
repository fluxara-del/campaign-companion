-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rulesetId" TEXT NOT NULL DEFAULT 'dnd5e-2024',
    "rulesetVersion" TEXT NOT NULL,
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "lastEventSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    CHECK ("stateVersion" >= 0),
    CHECK ("lastEventSeq" >= 0),
    CHECK (length("id") > 0)
);

-- CreateTable
CREATE TABLE "Member" (
    "campaignId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "actorId"),
    CONSTRAINT "Member_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("role" IN ('owner','player','ai_service','viewer'))
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hpCurrent" INTEGER NOT NULL,
    "hpMax" INTEGER,
    "hpTemp" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Character_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("hpCurrent" >= 0),
    CHECK ("hpMax" IS NULL OR "hpMax" >= 1),
    CHECK ("hpMax" IS NULL OR "hpCurrent" <= "hpMax"),
    CHECK ("hpTemp" >= 0)
);

-- CreateTable
CREATE TABLE "ResourcePool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "current" INTEGER,
    "max" INTEGER,
    "rechargePolicy" TEXT,
    CONSTRAINT "ResourcePool_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ResourcePool_campaignId_characterId_fkey" FOREIGN KEY ("campaignId", "characterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("current" IS NULL OR "current" >= 0),
    CHECK ("max" IS NULL OR "max" >= 0),
    CHECK ("current" IS NULL OR "max" IS NULL OR "current" <= "max"),
    CHECK ("rechargePolicy" IS NULL OR "rechargePolicy" IN ('short_rest','long_rest','manual'))
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "ownerCharacterId" TEXT,
    "purpose" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'cp',
    "amountMinor" INTEGER,
    CONSTRAINT "Wallet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Wallet_campaignId_ownerCharacterId_fkey" FOREIGN KEY ("campaignId", "ownerCharacterId") REFERENCES "Character" ("campaignId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("purpose" IN ('personal','group_dedicated')),
    CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0),
    CHECK ("purpose" <> 'personal' OR "ownerCharacterId" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "BatchReceipt" (
    "campaignId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "stateVersionBefore" INTEGER NOT NULL,
    "stateVersionAfter" INTEGER NOT NULL,
    "firstSeq" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "responseJson" TEXT NOT NULL,
    "committedAt" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "batchId"),
    CONSTRAINT "BatchReceipt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("stateVersionAfter" = "stateVersionBefore" + 1),
    CHECK ("firstSeq" >= 1 AND "lastSeq" >= "firstSeq")
);

-- CreateTable
CREATE TABLE "CommandIndex" (
    "campaignId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    PRIMARY KEY ("campaignId", "commandId"),
    CONSTRAINT "CommandIndex_campaignId_batchId_fkey" FOREIGN KEY ("campaignId", "batchId") REFERENCES "BatchReceipt" ("campaignId", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("position" >= 0)
);

-- CreateTable
CREATE TABLE "DomainEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "batchId" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "sourceRef" TEXT,
    "occurredAt" TEXT NOT NULL,
    "worldTime" TEXT,
    "visibility" TEXT NOT NULL,
    "knowledgeKind" TEXT,
    CONSTRAINT "DomainEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DomainEvent_campaignId_batchId_fkey" FOREIGN KEY ("campaignId", "batchId") REFERENCES "BatchReceipt" ("campaignId", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("seq" >= 1),
    CHECK ("schemaVersion" >= 1),
    CHECK ("actorKind" IN ('player','dm_manual','ai_service','import','system')),
    CHECK ("visibility" IN ('player','dm','shared')),
    CHECK ("knowledgeKind" IS NULL OR "knowledgeKind" IN ('observed','reported','rumor','inferred','canon')),
    CHECK (json_valid("payloadJson"))
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "batchId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "JournalEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('manual','projection','summary')),
    CHECK ("visibility" IN ('player','dm','shared')),
    CHECK ("revision" >= 1)
);

-- CreateTable
CREATE TABLE "JournalEventLink" (
    "journalEntryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,

    PRIMARY KEY ("journalEntryId", "eventId"),
    CONSTRAINT "JournalEventLink_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JournalEventLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignBaseline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stateVersion" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "CampaignBaseline_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("seq" >= 0),
    CHECK ("stateVersion" >= 0),
    CHECK ("source" IN ('synthetic','import')),
    CHECK (json_valid("snapshotJson"))
);

-- CreateIndex
CREATE UNIQUE INDEX "Character_campaignId_id_key" ON "Character"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ResourcePool_characterId_resourceKey_key" ON "ResourcePool"("characterId", "resourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResourcePool_campaignId_id_key" ON "ResourcePool"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_campaignId_id_key" ON "Wallet"("campaignId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BatchReceipt_campaignId_stateVersionAfter_key" ON "BatchReceipt"("campaignId", "stateVersionAfter");

-- CreateIndex
CREATE UNIQUE INDEX "CommandIndex_campaignId_batchId_position_key" ON "CommandIndex"("campaignId", "batchId", "position");

-- CreateIndex
CREATE INDEX "DomainEvent_campaignId_batchId_idx" ON "DomainEvent"("campaignId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEvent_campaignId_seq_key" ON "DomainEvent"("campaignId", "seq");

-- CreateIndex
CREATE INDEX "JournalEntry_campaignId_createdAt_idx" ON "JournalEntry"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBaseline_campaignId_seq_key" ON "CampaignBaseline"("campaignId", "seq");

-- kdz: event log, receipti, indeks naredbi, veze dnevnika i baseline su append-only (ADR-0004)
CREATE TRIGGER "DomainEvent_no_update" BEFORE UPDATE ON "DomainEvent"
BEGIN
    SELECT RAISE(ABORT, 'DomainEvent je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "DomainEvent_no_delete" BEFORE DELETE ON "DomainEvent"
BEGIN
    SELECT RAISE(ABORT, 'DomainEvent je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "BatchReceipt_no_update" BEFORE UPDATE ON "BatchReceipt"
BEGIN
    SELECT RAISE(ABORT, 'BatchReceipt je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "BatchReceipt_no_delete" BEFORE DELETE ON "BatchReceipt"
BEGIN
    SELECT RAISE(ABORT, 'BatchReceipt je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "CommandIndex_no_update" BEFORE UPDATE ON "CommandIndex"
BEGIN
    SELECT RAISE(ABORT, 'CommandIndex je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "CommandIndex_no_delete" BEFORE DELETE ON "CommandIndex"
BEGIN
    SELECT RAISE(ABORT, 'CommandIndex je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "JournalEventLink_no_update" BEFORE UPDATE ON "JournalEventLink"
BEGIN
    SELECT RAISE(ABORT, 'JournalEventLink je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "JournalEventLink_no_delete" BEFORE DELETE ON "JournalEventLink"
BEGIN
    SELECT RAISE(ABORT, 'JournalEventLink je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "CampaignBaseline_no_update" BEFORE UPDATE ON "CampaignBaseline"
BEGIN
    SELECT RAISE(ABORT, 'CampaignBaseline je nepromjenjiv (append-only)');
END;

CREATE TRIGGER "CampaignBaseline_no_delete" BEFORE DELETE ON "CampaignBaseline"
BEGIN
    SELECT RAISE(ABORT, 'CampaignBaseline je nepromjenjiv (append-only)');
END;

-- kdz: identitet i pripadnost kampanji se ne mijenjaju
CREATE TRIGGER "Character_immutable_identity" BEFORE UPDATE OF "id", "campaignId" ON "Character"
BEGIN
    SELECT RAISE(ABORT, 'Character id/campaignId su nepromjenjivi');
END;

CREATE TRIGGER "ResourcePool_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "characterId" ON "ResourcePool"
BEGIN
    SELECT RAISE(ABORT, 'ResourcePool id/campaignId/characterId su nepromjenjivi');
END;

CREATE TRIGGER "Wallet_immutable_identity" BEFORE UPDATE OF "id", "campaignId", "ownerCharacterId", "purpose" ON "Wallet"
BEGIN
    SELECT RAISE(ABORT, 'Wallet id/campaignId/vlasnik/svrha su nepromjenjivi');
END;

CREATE TRIGGER "Campaign_version_monotonic" BEFORE UPDATE OF "stateVersion", "lastEventSeq" ON "Campaign"
WHEN NEW."stateVersion" < OLD."stateVersion" OR NEW."lastEventSeq" < OLD."lastEventSeq"
BEGIN
    SELECT RAISE(ABORT, 'stateVersion/lastEventSeq ne smiju padati');
END;
