import type {
  ChangeRiskEvidence,
  CiEvidence,
  Release,
  ReleaseLookupResult,
  ReleaseNotFoundError,
  ReleaseRecord,
  SecurityEvidence,
  TestEvidence,
} from "./types";

export const RELEASE_RECORDS = [
  {
    id: "release-240",
    version: "2.4.0",
    name: "Release 2.4.0",
    risk: "LOW",
    updatedAt: "2026-08-01T00:00:00.000Z",
    branch: "release/2.4.0",
    commitSha: "8f4a2c9d1b6e3a7f0c5d9b2e1a4f6c8d3b7e0a2c",
    evidence: {
      ci: {
        status: "PASS",
        workflow: "release-validation",
        totalJobs: 8,
        passedJobs: 8,
        failedJobs: 0,
        durationSeconds: 642,
      },
      tests: {
        status: "PASS",
        total: 120,
        passed: 120,
        failed: 0,
        flaky: 0,
        coveragePercent: 91,
      },
      security: {
        status: "PASS",
        critical: 0,
        high: 0,
        medium: 0,
        low: 2,
      },
      changeRisk: {
        level: "LOW",
        filesChanged: 7,
        linesAdded: 184,
        linesDeleted: 42,
        changedComponents: ["api", "web"],
        reasons: [
          "Small, localized change set across stable API and web components.",
          "All CI jobs, automated tests, and security gates passed.",
          "No flaky tests or high-severity findings are present.",
        ],
      },
    },
  },
  {
    id: "release-250",
    version: "2.5.0",
    name: "Release 2.5.0",
    risk: "MEDIUM",
    updatedAt: "2026-08-15T00:00:00.000Z",
    branch: "release/2.5.0",
    commitSha: "3c9e1f6a8b2d4c7f0e5a1b9d6c3f8a2e4b7d0c1f",
    evidence: {
      ci: {
        status: "PASS",
        workflow: "release-validation",
        totalJobs: 9,
        passedJobs: 9,
        failedJobs: 0,
        durationSeconds: 718,
      },
      tests: {
        status: "WARNING",
        total: 100,
        passed: 94,
        failed: 0,
        flaky: 6,
        coveragePercent: 86,
      },
      security: {
        status: "PASS",
        critical: 0,
        high: 0,
        medium: 1,
        low: 3,
      },
      changeRisk: {
        level: "MEDIUM",
        filesChanged: 23,
        linesAdded: 824,
        linesDeleted: 219,
        changedComponents: ["api", "payments", "web"],
        reasons: [
          "Payment-sensitive changes require additional release owner review.",
          "Elevated change surface across API, payments, and web components.",
          "Flaky E2E tests remain at the conditional-go threshold.",
        ],
      },
    },
  },
  {
    id: "release-260",
    version: "2.6.0",
    name: "Release 2.6.0",
    risk: "HIGH",
    updatedAt: "2026-08-31T00:00:00.000Z",
    branch: "release/2.6.0",
    commitSha: "f1a7c3d9e5b2a8c0d4f6e1b9a3c7d5e0f2a6b8c4",
    evidence: {
      ci: {
        status: "FAIL",
        workflow: "release-validation",
        totalJobs: 10,
        passedJobs: 8,
        failedJobs: 2,
        durationSeconds: 931,
      },
      tests: {
        status: "FAIL",
        total: 140,
        passed: 131,
        failed: 5,
        flaky: 4,
        coveragePercent: 79,
      },
      security: {
        status: "FAIL",
        critical: 0,
        high: 2,
        medium: 4,
        low: 8,
      },
      changeRisk: {
        level: "HIGH",
        filesChanged: 68,
        linesAdded: 2840,
        linesDeleted: 973,
        changedComponents: [
          "api",
          "authentication",
          "payments",
          "release-orchestration",
          "web",
        ],
        reasons: [
          "Failed CI includes required release-validation jobs.",
          "Failed tests indicate genuine automated test regressions.",
          "High-severity security finding blocks release promotion.",
          "Large change surface spans several critical components.",
        ],
      },
    },
  },
] as const satisfies readonly ReleaseRecord[];

export const RELEASES: readonly Release[] = RELEASE_RECORDS.map((release) => ({
  id: release.id,
  version: release.version,
  name: release.name,
  risk: release.risk,
  updatedAt: release.updatedAt,
  branch: release.branch,
  commitSha: release.commitSha,
}));

export const RELEASE_SUMMARIES = RELEASES;

function createReleaseNotFoundError(releaseId: string): ReleaseNotFoundError {
  return {
    code: "RELEASE_NOT_FOUND",
    releaseId,
    message: `Release '${releaseId}' was not found.`,
  };
}

function createReleaseLookupResult<T>(
  releaseId: string,
  data: T | undefined,
): ReleaseLookupResult<T> {
  if (data === undefined) {
    return {
      ok: false,
      error: createReleaseNotFoundError(releaseId),
    };
  }

  return {
    ok: true,
    data,
  };
}

export function getReleaseRecordById(
  releaseId: string,
): ReleaseLookupResult<ReleaseRecord> {
  return createReleaseLookupResult(
    releaseId,
    RELEASE_RECORDS.find((release) => release.id === releaseId),
  );
}

export function getReleaseById(releaseId: string): ReleaseLookupResult<Release> {
  return createReleaseLookupResult(
    releaseId,
    RELEASES.find((release) => release.id === releaseId),
  );
}

export function getCiEvidenceByReleaseId(
  releaseId: string,
): ReleaseLookupResult<CiEvidence> {
  const release = getReleaseRecordById(releaseId);

  return release.ok
    ? { ok: true, data: release.data.evidence.ci }
    : { ok: false, error: release.error };
}

export function getTestEvidenceByReleaseId(
  releaseId: string,
): ReleaseLookupResult<TestEvidence> {
  const release = getReleaseRecordById(releaseId);

  return release.ok
    ? { ok: true, data: release.data.evidence.tests }
    : { ok: false, error: release.error };
}

export function getSecurityEvidenceByReleaseId(
  releaseId: string,
): ReleaseLookupResult<SecurityEvidence> {
  const release = getReleaseRecordById(releaseId);

  return release.ok
    ? { ok: true, data: release.data.evidence.security }
    : { ok: false, error: release.error };
}

export function getChangeRiskEvidenceByReleaseId(
  releaseId: string,
): ReleaseLookupResult<ChangeRiskEvidence> {
  const release = getReleaseRecordById(releaseId);

  return release.ok
    ? { ok: true, data: release.data.evidence.changeRisk }
    : { ok: false, error: release.error };
}
