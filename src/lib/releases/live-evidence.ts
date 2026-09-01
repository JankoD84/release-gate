import type {
  ChangeRiskEvidence,
  CiEvidence,
  ReleaseRecord,
  ReleaseRisk,
  SecurityEvidence,
  TestEvidence,
} from "./types.ts";

export const LIVE_REPOSITORY = "JankoD84/release-gate";
export const LIVE_BRANCH = "main";
export const LIVE_EVIDENCE_RELEASE_TAG = "live-evidence";
export const LIVE_EVIDENCE_ASSET_NAME = "release-gate-evidence.json";

export type LiveEvidenceWorkflow = {
  name: string;
  runId: string;
  runUrl: string;
};

export type LiveEvidenceDocument = {
  schemaVersion: 1;
  source: "github-actions";
  repository: typeof LIVE_REPOSITORY;
  branch: typeof LIVE_BRANCH;
  commitSha: string;
  generatedAt: string;
  workflow: LiveEvidenceWorkflow;
  release: ReleaseRecord;
};

export type LiveEvidenceErrorCode =
  | "LIVE_EVIDENCE_UNAVAILABLE"
  | "LIVE_EVIDENCE_INVALID"
  | "LIVE_RELEASE_NOT_CURRENT";

export type LiveEvidenceError = {
  code: LiveEvidenceErrorCode;
  message: string;
  releaseId?: string;
};

export type LiveEvidenceResult =
  | { ok: true; document: LiveEvidenceDocument }
  | { ok: false; error: LiveEvidenceError };

export type GitChangeStats = {
  filesChanged: number;
  linesAdded: number;
  linesDeleted: number;
  changedFiles: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function isRisk(value: unknown): value is ReleaseRisk {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH";
}

function isCiEvidence(value: unknown): value is CiEvidence {
  return (
    isRecord(value) &&
    (value.status === "PASS" || value.status === "FAIL" || value.status === "NOT_AVAILABLE") &&
    typeof value.workflow === "string" &&
    isNonNegativeInteger(value.totalJobs) &&
    isNonNegativeInteger(value.passedJobs) &&
    isNonNegativeInteger(value.failedJobs) &&
    isNonNegativeInteger(value.durationSeconds)
  );
}

function isTestEvidence(value: unknown): value is TestEvidence {
  return (
    isRecord(value) &&
    (value.status === "PASS" || value.status === "WARNING" || value.status === "FAIL" || value.status === "NOT_AVAILABLE") &&
    isNonNegativeInteger(value.total) &&
    isNonNegativeInteger(value.passed) &&
    isNonNegativeInteger(value.failed) &&
    isNonNegativeInteger(value.flaky) &&
    (value.coveragePercent === null || isNonNegativeInteger(value.coveragePercent))
  );
}

function isSecurityEvidence(value: unknown): value is SecurityEvidence {
  return (
    isRecord(value) &&
    (value.status === "PASS" || value.status === "WARNING" || value.status === "FAIL" || value.status === "NOT_AVAILABLE") &&
    isNonNegativeInteger(value.critical) &&
    isNonNegativeInteger(value.high) &&
    isNonNegativeInteger(value.medium) &&
    isNonNegativeInteger(value.low)
  );
}

function isChangeRiskEvidence(value: unknown): value is ChangeRiskEvidence {
  return (
    isRecord(value) &&
    (value.level === "LOW" || value.level === "MEDIUM" || value.level === "HIGH") &&
    isNonNegativeInteger(value.filesChanged) &&
    isNonNegativeInteger(value.linesAdded) &&
    isNonNegativeInteger(value.linesDeleted) &&
    Array.isArray(value.changedComponents) &&
    value.changedComponents.every((item) => typeof item === "string") &&
    Array.isArray(value.reasons) &&
    value.reasons.every((item) => typeof item === "string")
  );
}

function isReleaseRecord(value: unknown): value is ReleaseRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.version === "string" &&
    typeof value.name === "string" &&
    isRisk(value.risk) &&
    isIsoDate(value.updatedAt) &&
    value.branch === LIVE_BRANCH &&
    isCommitSha(value.commitSha) &&
    isRecord(value.evidence) &&
    isCiEvidence(value.evidence.ci) &&
    isTestEvidence(value.evidence.tests) &&
    isSecurityEvidence(value.evidence.security) &&
    isChangeRiskEvidence(value.evidence.changeRisk)
  );
}

export function validateLiveEvidenceDocument(value: unknown): LiveEvidenceResult {
  if (!isRecord(value)) {
    return invalid("Live evidence payload is not a JSON object.");
  }

  if (
    value.schemaVersion !== 1 ||
    value.source !== "github-actions" ||
    value.repository !== LIVE_REPOSITORY ||
    value.branch !== LIVE_BRANCH ||
    !isCommitSha(value.commitSha) ||
    !isIsoDate(value.generatedAt) ||
    !isRecord(value.workflow) ||
    typeof value.workflow.name !== "string" ||
    typeof value.workflow.runId !== "string" ||
    typeof value.workflow.runUrl !== "string" ||
    !isReleaseRecord(value.release)
  ) {
    return invalid("Live evidence payload is malformed or incomplete.");
  }

  if (value.release.commitSha !== value.commitSha || value.release.id !== `live-${value.commitSha}`) {
    return invalid("Live evidence release identity does not match the commit SHA.");
  }

  return {
    ok: true,
    document: {
      schemaVersion: 1,
      source: "github-actions",
      repository: LIVE_REPOSITORY,
      branch: LIVE_BRANCH,
      commitSha: value.commitSha,
      generatedAt: value.generatedAt,
      workflow: {
        name: value.workflow.name,
        runId: value.workflow.runId,
        runUrl: value.workflow.runUrl,
      },
      release: value.release,
    },
  };
}

function invalid(message: string): LiveEvidenceResult {
  return {
    ok: false,
    error: {
      code: "LIVE_EVIDENCE_INVALID",
      message,
    },
  };
}

export function createLiveReleaseNotCurrentError(releaseId: string): LiveEvidenceError {
  return {
    code: "LIVE_RELEASE_NOT_CURRENT",
    releaseId,
    message: `Release '${releaseId}' is not the current LIVE commit release. Refresh live evidence and retry.`,
  };
}

export function deriveChangedComponents(paths: readonly string[]): readonly string[] {
  const components = new Set<string>();

  for (const path of paths) {
    if (path.startsWith("src/app") || path.startsWith("src/components")) components.add("web");
    else if (path.startsWith("src/lib/webmcp")) components.add("agent-interface");
    else if (path.startsWith("src/lib/decision") || path.startsWith("src/lib/decisions")) components.add("release-orchestration");
    else if (path.startsWith("src/lib/releases")) components.add("release-data");
    else if (path.startsWith(".github")) components.add("ci");
    else if (/^(README|HACKATHON|DEMO|AGENT_EVALS|CLAUDE|AGENTS|LICENSE)|\.md$/i.test(path)) components.add("docs");
    else components.add("other");
  }

  return [...components].sort();
}

export function normalizeGitChangeRisk(stats: GitChangeStats): ChangeRiskEvidence {
  const changedComponents = deriveChangedComponents(stats.changedFiles);
  const totalLines = stats.linesAdded + stats.linesDeleted;
  const reasons: string[] = [];

  if (stats.filesChanged === 0) {
    reasons.push("No changed files were detected in the evaluated Git range.");
  } else {
    reasons.push(`${stats.filesChanged} file(s) changed with ${stats.linesAdded} line(s) added and ${stats.linesDeleted} line(s) deleted.`);
  }

  if (changedComponents.length > 0) {
    reasons.push(`Changed component(s): ${changedComponents.join(", ")}.`);
  }

  let level: ChangeRiskEvidence["level"] = "LOW";

  if (stats.filesChanged >= 40 || totalLines >= 1500 || changedComponents.length >= 5) {
    level = "HIGH";
    reasons.push("Large change surface detected from Git statistics.");
  } else if (stats.filesChanged >= 12 || totalLines >= 400 || changedComponents.some((component) => component === "release-orchestration" || component === "agent-interface" || component === "ci")) {
    level = "MEDIUM";
    reasons.push("Moderate change surface or release-critical component changes detected.");
  } else {
    reasons.push("Small localized change surface detected.");
  }

  return {
    level,
    filesChanged: stats.filesChanged,
    linesAdded: stats.linesAdded,
    linesDeleted: stats.linesDeleted,
    changedComponents,
    reasons,
  };
}

export function riskFromChangeRisk(level: ChangeRiskEvidence["level"]): ReleaseRisk {
  return level;
}
