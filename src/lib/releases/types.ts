export type ReleaseRisk = "LOW" | "MEDIUM" | "HIGH";

export type CiStatus = "PASS" | "FAIL";

export type TestStatus = "PASS" | "WARNING" | "FAIL";

export type SecurityStatus = "PASS" | "WARNING" | "FAIL";

export type ChangeRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type Release = {
  id: string;
  version: string;
  name: string;
  risk: ReleaseRisk;
  updatedAt: string;
  branch: string;
  commitSha: string;
};

export type CiEvidence = {
  status: CiStatus;
  workflow: string;
  totalJobs: number;
  passedJobs: number;
  failedJobs: number;
  durationSeconds: number;
};

export type TestEvidence = {
  status: TestStatus;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  coveragePercent: number;
};

export type SecurityEvidence = {
  status: SecurityStatus;
  critical: number;
  high: number;
  medium: number;
  low: number;
};

export type ChangeRiskEvidence = {
  level: ChangeRiskLevel;
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  changedComponents: readonly string[];
  reasons: readonly string[];
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

export type ReleaseLookupResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ReleaseNotFoundError;
    };
