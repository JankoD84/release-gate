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
import { type PublicRepositorySnapshot } from "./public-adapters.ts";
import { getActiveRepositoryReference, type RepositoryReference } from "./repository.ts";
import type {
  ChangeRiskEvidence,
  CiEvidence,
  Release,
  ReleaseLookupResult,
  ReleaseNotFoundError,
  ReleaseRecord,
  PublicRepositoryError,
  SecurityEvidence,
  TestEvidence,
} from "./types.ts";

export type ReleaseWithDecision = Release & {
  decision: ReleaseDecision;
};

export type ReleaseProviderError = ReleaseNotFoundError | PublicRepositoryError;

export type ProviderLookupResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ReleaseProviderError };

export type ListReleasesProviderResult =
  | {
      ok: true;
      mode: ReleaseMode;
      releases: readonly ReleaseWithDecision[];
      repository?: RepositoryReference;
      source?: PublicRepositorySnapshot["source"];
    }
  | { ok: false; mode: ReleaseMode; error: ReleaseProviderError };

export type ProviderMutationResult = FinalDecisionMutationResult | { ok: false; error: ReleaseProviderError };

export type ReleaseProvider = {
  listReleases(): Promise<ListReleasesProviderResult>;
  getRelease(releaseId: string): Promise<ProviderLookupResult<ReleaseWithDecision>>;
  getReleaseRecord(releaseId: string): Promise<ProviderLookupResult<ReleaseRecord>>;
  getCiEvidence(releaseId: string): Promise<ProviderLookupResult<CiEvidence>>;
  getTestEvidence(releaseId: string): Promise<ProviderLookupResult<TestEvidence>>;
  getSecurityEvidence(releaseId: string): Promise<ProviderLookupResult<SecurityEvidence>>;
  getChangeRiskEvidence(releaseId: string): Promise<ProviderLookupResult<ChangeRiskEvidence>>;
  analyzeRelease(releaseId: string): Promise<ProviderLookupResult<DecisionAnalysis>>;
  approveRelease(releaseId: string, acknowledgement: boolean): Promise<ProviderMutationResult>;
  rejectRelease(releaseId: string, reason?: string): Promise<ProviderMutationResult>;
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

async function fetchLiveEvidence(init?: RequestInit): Promise<ProviderLookupResult<PublicRepositorySnapshot>> {
  const fetcher = liveFetchOverride ?? fetch;
  const reference = getActiveRepositoryReference();

  try {
    const response = await fetcher(`/api/live-evidence?repositoryUrl=${encodeURIComponent(reference.url)}`, init);
    const payload: unknown = await response.json();

    if (!response.ok) {
      const error = isProviderError(payload)
        ? payload
        : { code: "PROVIDER_UNAVAILABLE" as const, message: "Public repository evidence is currently unavailable." };
      return { ok: false, error };
    }

    return isSnapshot(payload)
      ? { ok: true, data: payload }
      : { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "Public repository evidence payload was malformed." } };
  } catch {
    return {
      ok: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "Public repository evidence is currently unavailable.",
      },
    };
  }
}

function isProviderError(value: unknown): value is PublicRepositoryError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    (value.code === "INVALID_REPOSITORY_URL" ||
      value.code === "UNSUPPORTED_REPOSITORY_PROVIDER" ||
      value.code === "REPOSITORY_NOT_FOUND" ||
      value.code === "PROVIDER_RATE_LIMITED" ||
      value.code === "PROVIDER_UNAVAILABLE" ||
      value.code === "EVIDENCE_NOT_AVAILABLE") &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function isSnapshot(value: unknown): value is PublicRepositorySnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "repository" in value &&
    typeof value.repository === "object" &&
    value.repository !== null &&
    "releases" in value &&
    Array.isArray(value.releases)
  );
}

function createReleaseNotFoundError(releaseId: string): ReleaseNotFoundError {
  return {
    code: "RELEASE_NOT_FOUND",
    releaseId,
    message: `Release '${releaseId}' was not found.`,
  };
}

function currentReleaseOrError(
  snapshot: PublicRepositorySnapshot,
  releaseId: string,
): ProviderLookupResult<ReleaseRecord> {
  const release = snapshot.releases.find((candidate) => candidate.id === releaseId);

  return release ? { ok: true, data: release } : { ok: false, error: createReleaseNotFoundError(releaseId) };
}

function createLiveReleaseWithDecision(record: ReleaseRecord): ReleaseWithDecision {
  return {
    ...record,
    decision: analyzeReleaseRecord(record).data.decision,
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
      releases: evidence.data.releases.map(createLiveReleaseWithDecision),
      repository: getActiveRepositoryReference(),
      source: evidence.data.source,
    };
  },
  async getRelease(releaseId) {
    const record = await this.getReleaseRecord(releaseId);

    return record.ok
      ? { ok: true, data: createLiveReleaseWithDecision(record.data) }
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
