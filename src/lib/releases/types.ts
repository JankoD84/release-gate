export type ReleaseRisk = "LOW" | "MEDIUM" | "HIGH";

export type EvidenceAvailability = "AVAILABLE" | "NOT_AVAILABLE";

export type EvidenceSourceType =
  | "repository"
  | "release"
  | "tag"
  | "commit"
  | "workflow"
  | "pipeline"
  | "compare"
  | "provider-api";

export type EvidenceProvenance = {
  provider: "github" | "gitlab";
  repository: string;
  sourceType: EvidenceSourceType;
  label: string;
  externalUrl?: string;
  observedAt?: string;
};

export type CiStatus = "PASS" | "FAIL" | "NOT_AVAILABLE";

export type TestStatus = "PASS" | "WARNING" | "FAIL" | "NOT_AVAILABLE";

export type SecurityStatus = "PASS" | "WARNING" | "FAIL" | "NOT_AVAILABLE";

export type ChangeRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type Release = {
  id: string;
  version: string;
  name: string;
  risk: ReleaseRisk;
  updatedAt: string;
  branch: string;
  commitSha: string;
  provenance?: EvidenceProvenance;
};

export type CiEvidence = {
  status: CiStatus;
  workflow: string;
  totalJobs: number;
  passedJobs: number;
  failedJobs: number;
  durationSeconds: number;
  provenance?: EvidenceProvenance;
};

export type TestEvidence = {
  status: TestStatus;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  coveragePercent: number | null;
  provenance?: EvidenceProvenance;
};

export type SecurityEvidence = {
  status: SecurityStatus;
  critical: number;
  high: number;
  medium: number;
  low: number;
  provenance?: EvidenceProvenance;
};

export type ChangeRiskEvidence = {
  level: ChangeRiskLevel;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  changedComponents: readonly string[];
  reasons: readonly string[];
  provenance?: EvidenceProvenance;
};

export type ReleaseEvidence = {
  ci: CiEvidence;
  tests: TestEvidence;
  security: SecurityEvidence;
  changeRisk: ChangeRiskEvidence;
};

export type ReleaseRecord = Release & {
  evidence: ReleaseEvidence;
};

export type ReleaseNotFoundError = {
  code: "RELEASE_NOT_FOUND";
  releaseId: string;
  message: string;
};

export type PublicRepositoryError = {
  code:
    | "INVALID_REPOSITORY_URL"
    | "UNSUPPORTED_REPOSITORY_PROVIDER"
    | "REPOSITORY_NOT_FOUND"
    | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_UNAVAILABLE"
    | "EVIDENCE_NOT_AVAILABLE";
  message: string;
  status?: number;
};

export type ReleaseLookupResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ReleaseNotFoundError;
    };
