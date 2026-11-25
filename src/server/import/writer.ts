import { canonicalJson } from "@/domain/canonical";
import { createCampaign } from "@/server/store/campaign-setup";
import type { Db } from "@/server/store/connection";
import { IMPORTER_VERSION, type ImportPlan, type SourceManifest } from "./types";

/**
 * Upisuje plan u (probnu) bazu u jednoj transakciji: kampanja, lik, resursi, novčanici,
 * predmeti, profil, registri, legacy događaji, dokumenti, zapis uvoza i baseline.
 * Ne stvara domenske događaje: uvezeno stanje je polazište replaya, ne promjena.
 */
export function writeImport(
  db: Db,
  plan: ImportPlan,
  manifest: SourceManifest,
  meta: { importBatchId: string; manifestHash: string; contentHash: string; reportJson: string; now: string },
): { baselineHash: string } {
  const cid = plan.setup.id;
  return createCampaign(db, plan.setup, {
    now: meta.now,
    source: "import",
    extra: (tx) => {
      tx.prepare(
        `INSERT INTO "ImportBatch" (id, campaignId, status, importerVersion, sourceManifestJson, sourceManifestHash, contentHash, legacyStateVersion, legacyLastEventId, reportJson, createdAt)
         VALUES (?, ?, 'trial', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        meta.importBatchId,
        cid,
        IMPORTER_VERSION,
        canonicalJson(manifest),
        meta.manifestHash,
        meta.contentHash,
        plan.legacy.stateVersion,
        plan.legacy.lastEventId,
        meta.reportJson,
        meta.now,
      );

      // Predmeti: najprije bez spremnika, zatim veze (redoslijed ne ovisi o poretku u izvoru).
      const insItem = tx.prepare(
        `INSERT INTO "ItemInstance" (id, campaignId, name, quantity, ownerRef, holderRef, location, containerItemId, equipped, attuned, massLbTenths, stateNote, attributesJson, sourceRef)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?)`,
      );
      const bool = (b: boolean | null) => (b === null ? null : b ? 1 : 0);
      for (const it of plan.items) {
        insItem.run(it.id, cid, it.name, it.quantity, it.ownerRef, it.holderRef, it.location, bool(it.equipped), bool(it.attuned), it.stateNote, canonicalJson(it.attributes), it.sourceRef);
      }
      const setContainer = tx.prepare(`UPDATE "ItemInstance" SET containerItemId = ? WHERE campaignId = ? AND id = ?`);
      for (const it of plan.items) if (it.containerItemId) setContainer.run(it.containerItemId, cid, it.id);

      if (plan.profile) {
        tx.prepare(`INSERT INTO "CharacterProfile" (campaignId, characterId, profileJson, sourceRef) VALUES (?, ?, ?, ?)`).run(
          cid,
          plan.profile.characterId,
          canonicalJson(plan.profile.data),
          plan.profile.sourceRef,
        );
      }

      const insEntity = tx.prepare(
        `INSERT INTO "EntityRecord" (id, campaignId, kind, name, status, visibility, dataJson, sourceRef) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of plan.entities) insEntity.run(e.id, cid, e.kind, e.name, e.status, e.visibility, canonicalJson(e.data), e.sourceRef);

      const insLegacy = tx.prepare(
        `INSERT INTO "LegacyEvent" (campaignId, legacyId, position, sessionId, legacyStateVersion, type, title, rawJson, rawSha256, sourceFile, sourceLine, importBatchId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of plan.legacyEvents) {
        insLegacy.run(cid, e.legacyId, e.position, e.sessionId, e.legacyStateVersion, e.type, e.title, e.rawJson, e.rawSha256, e.sourceFile, e.sourceLine, meta.importBatchId);
      }

      const insDoc = tx.prepare(
        `INSERT INTO "SourceDocument" (campaignId, path, kind, sha256, content, importBatchId) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const d of plan.documents) insDoc.run(cid, d.path, d.kind, d.sha256, d.content, meta.importBatchId);
    },
  });
}
