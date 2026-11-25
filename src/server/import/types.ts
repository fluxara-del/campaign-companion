import type { CampaignSetup } from "@/server/store/campaign-setup";

export const IMPORTER_VERSION = "kdz-import/1";

export type Severity = "error" | "warning" | "info";

/** Nalaz uvoza. `error` blokira probni upis; ostalo ide u izvještaj. */
export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  source?: string;
  details?: Record<string, unknown>;
};

export type ManifestEntry = { path: string; sha256: string; size: number };

export type SourceManifest = {
  formatVersion: 1;
  files: ManifestEntry[];
  /** Top-level stavke izvora koje se namjerno ne čitaju (samo imena, bez sadržaja). */
  excluded: string[];
};

export type ItemRow = {
  id: string;
  name: string;
  quantity: number | null;
  ownerRef: string | null;
  holderRef: string | null;
  location: string | null;
  containerItemId: string | null;
  equipped: boolean | null;
  attuned: boolean | null;
  stateNote: string | null;
  attributes: unknown;
  sourceRef: string;
};

export type LegacyEventRow = {
  legacyId: string;
  position: number;
  sessionId: string | null;
  legacyStateVersion: number | null;
  type: string | null;
  title: string | null;
  rawJson: string;
  rawSha256: string;
  sourceFile: string;
  sourceLine: number;
};

export type EntityRow = {
  id: string;
  kind: "npc" | "quest" | "relationship";
  name: string;
  status: string | null;
  visibility: "player" | "dm" | "shared";
  data: unknown;
  sourceRef: string;
};

export type DocumentRow = { path: string; kind: "session" | "handoff" | "world" | "other"; sha256: string; content: string };

export type ImportPlan = {
  setup: CampaignSetup;
  legacy: { stateVersion: number | null; lastEventId: string | null };
  profile: { characterId: string; data: unknown; sourceRef: string } | null;
  items: ItemRow[];
  legacyEvents: LegacyEventRow[];
  entities: EntityRow[];
  documents: DocumentRow[];
  /** Mapiranje izvornih vrijednosti na nove ID-jeve (za izvještaj i usporedbu). */
  mapping: Record<string, string>;
};
