import { analyzeReleaseRecord } from "../decision/engine.ts";
import { getActivityLog } from "../decisions/activity-store.ts";
import type { ActivityLogResult } from "../decisions/activity-types.ts";
import {
  approveRelease,
  approveReleaseRecord,
  getFinalDecision,
  rejectRelease,
  rejectReleaseRecord,
} from "../decisions/final-decision-store.ts";
import type {
  FinalDecisionMutationResult,
  FinalDecisionState,
} from "../decisions/final-decision-types.ts";
import type { ReleaseMode } from "../mode.ts";
import {
  analyzeRelease,
} from "../decision/engine.ts";
import type { DecisionAnalysis, ReleaseDecision } from "../decision/types.ts";
import {
  getChangeRiskEvidenceByReleaseId,
  getCiEvidenceByReleaseId,
  getReleaseById,
  getReleaseRecordById,
  getSecurityEvidenceByReleaseId,
  getTestEvidenceByReleaseId,
  RELEASES,
} from "./fixtures.ts";
import {
  createLiveReleaseNotCurrentError,
  type LiveEvidenceDocument,
  type LiveEvidenceError,
  validateLiveEvidenceDocument,
} from "./live-evidence.ts";
import type {
  ChangeRiskEvidence,
  CiEvidence,
  Release,
  ReleaseLookupResult,
  ReleaseNotFoundError,
  ReleaseRecord,
  SecurityEvidence,
  TestEvidence,
} from "./types.ts";

export type ReleaseWithDecision = Release & {
  decision: ReleaseDecision;
};

export type ReleaseProviderError = ReleaseNotFoundError | LiveEvidenceError;

export type ProviderLookupResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ReleaseProviderError };

export type ListReleasesProviderResult =
  | {
      ok: true;
      mode: ReleaseMode;
      releases: readonly ReleaseWithDecision[];
      source?: LiveEvidenceDocument;
    }
  | { ok: false; mode: ReleaseMode; error: ReleaseProviderError };

export type ReleaseProvider = {
  listReleases(): Promise<ListReleasesProviderResult>;
  getRelease(releaseId: string): Promise<ProviderLookupResult<ReleaseWithDecision>>;
  getReleaseRecord(releaseId: string): Promise<ProviderLookupResult<ReleaseRecord>>;
  getCiEvidence(releaseId: string): Promise<ProviderLookupResult<CiEvidence>>;
  getTestEvidence(releaseId: string): Promise<ProviderLookupResult<TestEvidence>>;
  getSecurityEvidence(releaseId: string): Promise<ProviderLookupResult<SecurityEvidence>>;
  getChangeRiskEvidence(releaseId: string): Promise<ProviderLookupResult<ChangeRiskEvidence>>;
  analyzeRelease(releaseId: string): Promise<ProviderLookupResult<DecisionAnalysis>>;
  approveRelease(releaseId: string, acknowledgement: boolean): Promise<FinalDecisionMutationResult>;
  rejectRelease(releaseId: string, reason?: string): Promise<FinalDecisionMutationResult>;
  getFinalDecision(releaseId: string): Promise<FinalDecisionState | { error: ReleaseProviderError }>;
  getActivityLog(releaseId?: string): Promise<ActivityLogResult>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let liveFetchOverride: FetchLike | null = null;

function toProviderLookup<T>(result: ReleaseLookupResult<T>): ProviderLookupResult<T> {
  return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
}

function createReleaseWithDecision(release: Release): ReleaseWithDecision {
  const analysis = analyzeRelease(release.id);

  return {
    ...release,
    decision: analysis.ok ? analysis.data.decision : "NO_GO",
  };
}

export const DemoReleaseProvider: ReleaseProvider = {
  async listReleases() {
    return {
      ok: true,
      mode: "DEMO",
      releases: RELEASES.map(createReleaseWithDecision),
    };
  },
  async getRelease(releaseId) {
    const release = getReleaseById(releaseId);
    return release.ok
      ? { ok: true, data: createReleaseWithDecision(release.data) }
      : { ok: false, error: release.error };
  },
  async getReleaseRecord(releaseId) {
    return toProviderLookup(getReleaseRecordById(releaseId));
  },
  async getCiEvidence(releaseId) {
    return toProviderLookup(getCiEvidenceByReleaseId(releaseId));
  },
  async getTestEvidence(releaseId) {
    return toProviderLookup(getTestEvidenceByReleaseId(releaseId));
  },
  async getSecurityEvidence(releaseId) {
    return toProviderLookup(getSecurityEvidenceByReleaseId(releaseId));
  },
  async getChangeRiskEvidence(releaseId) {
    return toProviderLookup(getChangeRiskEvidenceByReleaseId(releaseId));
  },
  async analyzeRelease(releaseId) {
    const result = analyzeRelease(releaseId);
    return result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error };
  },
  async approveRelease(releaseId, acknowledgement) {
    return approveRelease(releaseId, acknowledgement);
  },
  async rejectRelease(releaseId, reason) {
    return rejectRelease(releaseId, reason);
  },
  async getFinalDecision(releaseId) {
    const release = getReleaseById(releaseId);
    return release.ok ? getFinalDecision(releaseId) : { error: release.error };
  },
  async getActivityLog(releaseId) {
    return getActivityLog(releaseId, "DEMO");
  },
};

async function fetchLiveEvidence(init?: RequestInit): Promise<ProviderLookupResult<LiveEvidenceDocument>> {
  const fetcher = liveFetchOverride ?? fetch;

  try {
    const response = await fetcher("/api/live-evidence", init);
    const payload: unknown = await response.json();

    if (!response.ok) {
      const error = isProviderError(payload)
        ? payload
        : { code: "LIVE_EVIDENCE_UNAVAILABLE" as const, message: "Live evidence is currently unavailable." };
      return { ok: false, error };
    }

    const validated = validateLiveEvidenceDocument(payload);

    return validated.ok
      ? { ok: true, data: validated.document }
      : { ok: false, error: validated.error };
  } catch {
    return {
      ok: false,
      error: {
        code: "LIVE_EVIDENCE_UNAVAILABLE",
        message: "Live evidence is currently unavailable.",
      },
    };
  }
}

function isProviderError(value: unknown): value is LiveEvidenceError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value.code === "LIVE_EVIDENCE_UNAVAILABLE" ||
      value.code === "LIVE_EVIDENCE_INVALID" ||
      value.code === "LIVE_RELEASE_NOT_CURRENT") &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function currentReleaseOrError(
  document: LiveEvidenceDocument,
  releaseId: string,
): ProviderLookupResult<ReleaseRecord> {
  if (document.release.id !== releaseId) {
    return {
      ok: false,
      error: createLiveReleaseNotCurrentError(releaseId),
    };
  }

  return { ok: true, data: document.release };
}

function createLiveReleaseWithDecision(document: LiveEvidenceDocument): ReleaseWithDecision {
  return {
    ...document.release,
    decision: analyzeReleaseRecord(document.release).data.decision,
  };
}

export const LiveReleaseProvider: ReleaseProvider = {
  async listReleases() {
    const evidence = await fetchLiveEvidence();

    if (!evidence.ok) {
      return { ok: false, mode: "LIVE", error: evidence.error };
    }

    return {
      ok: true,
      mode: "LIVE",
      releases: [createLiveReleaseWithDecision(evidence.data)],
      source: evidence.data,
    };
  },
  async getRelease(releaseId) {
    const record = await this.getReleaseRecord(releaseId);

    return record.ok
      ? { ok: true, data: { ...record.data, decision: analyzeReleaseRecord(record.data).data.decision } }
      : record;
  },
  async getReleaseRecord(releaseId) {
    const evidence = await fetchLiveEvidence();

    return evidence.ok ? currentReleaseOrError(evidence.data, releaseId) : evidence;
  },
  async getCiEvidence(releaseId) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? { ok: true, data: record.data.evidence.ci } : record;
  },
  async getTestEvidence(releaseId) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? { ok: true, data: record.data.evidence.tests } : record;
  },
  async getSecurityEvidence(releaseId) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? { ok: true, data: record.data.evidence.security } : record;
  },
  async getChangeRiskEvidence(releaseId) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? { ok: true, data: record.data.evidence.changeRisk } : record;
  },
  async analyzeRelease(releaseId) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? analyzeReleaseRecord(record.data) : record;
  },
  async approveRelease(releaseId, acknowledgement) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? approveReleaseRecord(record.data, acknowledgement) : { ok: false, error: record.error };
  },
  async rejectRelease(releaseId, reason) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? rejectReleaseRecord(record.data, reason) : { ok: false, error: record.error };
  },
  async getFinalDecision(releaseId) {
    const record = await this.getReleaseRecord(releaseId);
    return record.ok ? getFinalDecision(releaseId) : { error: record.error };
  },
  async getActivityLog(releaseId) {
    return getActivityLog(releaseId, "LIVE");
  },
};

export function getReleaseProvider(mode: ReleaseMode): ReleaseProvider {
  return mode === "LIVE" ? LiveReleaseProvider : DemoReleaseProvider;
}

export function setLiveEvidenceFetchForTests(fetcher: FetchLike | null): void {
  liveFetchOverride = fetcher;
}
