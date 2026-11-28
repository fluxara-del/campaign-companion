-- Faza 4a: sesije, tvrdnje znanja i sesija događaja. Nedestruktivno: novi stupac s NULL i nove tablice.

-- AlterTable
ALTER TABLE "DomainEvent" ADD COLUMN "sessionId" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "number" INTEGER NOT NULL CHECK ("number" >= 1),
    "title" TEXT,
    "status" TEXT NOT NULL CHECK ("status" IN ('open','closed')),
    "startVersion" INTEGER NOT NULL CHECK ("startVersion" >= 0),
    "endVersion" INTEGER,
    "startedSeq" INTEGER NOT NULL CHECK ("startedSeq" >= 1),
    "endedSeq" INTEGER,
    "startedAt" TEXT NOT NULL,
    "endedAt" TEXT,

    PRIMARY KEY ("campaignId", "id"),
    CONSTRAINT "Session_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("status" = 'open' AND "endVersion" IS NULL AND "endedSeq" IS NULL AND "endedAt" IS NULL)
        OR ("status" = 'closed' AND "endVersion" >= "startVersion" AND "endedSeq" > "startedSeq" AND "endedAt" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "KnowledgeAssertion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL CHECK ("subjectKind" IN ('npc','quest','location','world')),
    "subjectId" TEXT,
    "text" TEXT NOT NULL CHECK (length("text") >= 1),
    "knowledgeKind" TEXT NOT NULL CHECK ("knowledgeKind" IN ('observed','reported','rumor','inferred','canon')),
    "visibility" TEXT NOT NULL CHECK ("visibility" IN ('player','dm','shared')),
    "sourceRef" TEXT,
    "status" TEXT NOT NULL CHECK ("status" IN ('active','superseded','retracted')),
    "sourceEventId" TEXT NOT NULL,
    "createdSeq" INTEGER NOT NULL CHECK ("createdSeq" >= 1),
    "correctedByEventId" TEXT,
    "supersededById" TEXT,

    PRIMARY KEY ("campaignId", "id"),
    CONSTRAINT "KnowledgeAssertion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK (("status" = 'active' AND "correctedByEventId" IS NULL AND "supersededById" IS NULL)
        OR ("status" = 'superseded' AND "correctedByEventId" IS NOT NULL AND "supersededById" IS NOT NULL)
        OR ("status" = 'retracted' AND "correctedByEventId" IS NOT NULL AND "supersededById" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_campaignId_number_key" ON "Session"("campaignId", "number");

-- CreateIndex
CREATE INDEX "KnowledgeAssertion_campaignId_subjectKind_subjectId_idx" ON "KnowledgeAssertion"("campaignId", "subjectKind", "subjectId");

-- Najviše jedna otvorena sesija po kampanji.
CREATE UNIQUE INDEX "Session_one_open_per_campaign" ON "Session"("campaignId") WHERE "status" = 'open';

-- Zatvorena sesija se ne mijenja; otvorena se smije samo zatvoriti. Identitet je nepromjenjiv.
CREATE TRIGGER "Session_closed_final" BEFORE UPDATE ON "Session"
WHEN OLD."status" = 'closed'
   OR NEW."id" <> OLD."id" OR NEW."campaignId" <> OLD."campaignId" OR NEW."number" <> OLD."number"
   OR NEW."startVersion" <> OLD."startVersion" OR NEW."startedSeq" <> OLD."startedSeq" OR NEW."startedAt" <> OLD."startedAt"
   OR NEW."title" IS NOT OLD."title"
BEGIN
    SELECT RAISE(ABORT, 'Session: zatvorena sesija i identitet sesije su nepromjenjivi');
END;
CREATE TRIGGER "Session_no_delete" BEFORE DELETE ON "Session"
BEGIN
    SELECT RAISE(ABORT, 'Session je append-only');
END;

-- Tvrdnja: tekst, vrsta znanja, vidljivost, subjekt i izvor su nepromjenjivi; mijenja se samo status
-- (active → superseded/retracted, jednom) uz događaj ispravke. Brisanje nije dopušteno.
CREATE TRIGGER "KnowledgeAssertion_immutable" BEFORE UPDATE ON "KnowledgeAssertion"
WHEN OLD."status" <> 'active'
   OR NEW."id" <> OLD."id" OR NEW."campaignId" <> OLD."campaignId" OR NEW."subjectKind" <> OLD."subjectKind"
   OR NEW."subjectId" IS NOT OLD."subjectId" OR NEW."text" <> OLD."text" OR NEW."knowledgeKind" <> OLD."knowledgeKind"
   OR NEW."visibility" <> OLD."visibility" OR NEW."sourceRef" IS NOT OLD."sourceRef" OR NEW."sourceEventId" <> OLD."sourceEventId"
   OR NEW."createdSeq" <> OLD."createdSeq"
BEGIN
    SELECT RAISE(ABORT, 'KnowledgeAssertion: tvrdnja se ne prepisuje; ispravka dodaje novu');
END;
CREATE TRIGGER "KnowledgeAssertion_no_delete" BEFORE DELETE ON "KnowledgeAssertion"
BEGIN
    SELECT RAISE(ABORT, 'KnowledgeAssertion je append-only');
END;
