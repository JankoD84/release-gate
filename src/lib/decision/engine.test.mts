import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRelease, evaluateReleaseEvidence } from "./engine.ts";
import type { ReleaseEvidence } from "../releases/types.ts";

const evaluatedAt = "2026-08-31T12:00:00.000Z";

const cleanEvidence: ReleaseEvidence = {
  ci: {
    status: "PASS",
    workflow: "release-validation",
    totalJobs: 1,
    passedJobs: 1,
    failedJobs: 0,
    durationSeconds: 60,
  },
  tests: {
    status: "PASS",
    total: 10,
    passed: 10,
    failed: 0,
    flaky: 0,
    coveragePercent: 90,
  },
  security: {
    status: "PASS",
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
  changeRisk: {
    level: "LOW",
    filesChanged: 2,
    linesAdded: 12,
    linesDeleted: 3,
    changedComponents: ["web"],
    reasons: ["Small localized change."],
  },
};

test("release-240 analyzes as GO", () => {
  const result = analyzeRelease("release-240", { evaluatedAt });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision, "GO");
  assert.equal(result.data.confidence, "HIGH");
  assert.deepEqual(result.data.blockingEvidence, []);
  assert.deepEqual(result.data.warnings, []);
  assert.deepEqual(result.data.conditions, []);
  assert.equal(result.data.evaluatedAt, evaluatedAt);
});

test("release-250 analyzes as CONDITIONAL_GO with warnings and conditions", () => {
  const result = analyzeRelease("release-250", { evaluatedAt });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision, "CONDITIONAL_GO");
  assert.equal(result.data.confidence, "MEDIUM");
  assert.deepEqual(result.data.blockingEvidence, []);
  assert.ok(
    result.data.warnings.some((warning) => warning.code === "FLAKY_TESTS_PRESENT"),
  );
  assert.ok(
    result.data.warnings.some((warning) => warning.code === "CHANGE_RISK_MEDIUM"),
  );
  assert.ok(result.data.conditions.length > 0);
  assert.ok(
    result.data.conditions.some((condition) =>
      condition.toLowerCase().includes("flaky-test risk"),
    ),
  );
});

test("release-260 analyzes as NO_GO with every hard blocker", () => {
  const result = analyzeRelease("release-260", { evaluatedAt });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision, "NO_GO");
  assert.equal(result.data.confidence, "HIGH");
  assert.ok(
    result.data.blockingEvidence.some((blocker) => blocker.code === "CI_FAILED"),
  );
  assert.ok(
    result.data.blockingEvidence.some((blocker) => blocker.code === "TESTS_FAILED"),
  );
  assert.ok(
    result.data.blockingEvidence.some(
      (blocker) => blocker.code === "SECURITY_HIGH_FINDINGS",
    ),
  );
  assert.deepEqual(result.data.conditions, []);
});

test("unknown release analysis uses RELEASE_NOT_FOUND", () => {
  const result = analyzeRelease("release-does-not-exist", { evaluatedAt });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RELEASE_NOT_FOUND");
  assert.equal(result.error.releaseId, "release-does-not-exist");
});

test("CI FAIL alone is NO_GO", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-ci-fail",
    {
      ...cleanEvidence,
      ci: {
        ...cleanEvidence.ci,
        status: "FAIL",
        failedJobs: 1,
      },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.decision, "NO_GO");
  assert.ok(analysis.blockingEvidence.some((blocker) => blocker.code === "CI_FAILED"));
});

test("HIGH security finding alone is NO_GO", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-security-high",
    {
      ...cleanEvidence,
      security: {
        ...cleanEvidence.security,
        status: "FAIL",
        high: 1,
      },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.decision, "NO_GO");
  assert.ok(
    analysis.blockingEvidence.some(
      (blocker) => blocker.code === "SECURITY_HIGH_FINDINGS",
    ),
  );
});

test("flaky tests without blockers are CONDITIONAL_GO", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-flaky-tests",
    {
      ...cleanEvidence,
      tests: {
        ...cleanEvidence.tests,
        status: "WARNING",
        flaky: 1,
      },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.decision, "CONDITIONAL_GO");
  assert.ok(
    analysis.warnings.some((warning) => warning.code === "FLAKY_TESTS_PRESENT"),
  );
  assert.ok(analysis.conditions.length > 0);
});

test("clean evidence is GO with no remediation actions", () => {
  const analysis = evaluateReleaseEvidence("unit-clean", cleanEvidence, {
    evaluatedAt,
  });

  assert.equal(analysis.decision, "GO");
  assert.equal(analysis.confidence, "HIGH");
  assert.deepEqual(analysis.blockingEvidence, []);
  assert.deepEqual(analysis.warnings, []);
  assert.deepEqual(analysis.conditions, []);
  assert.deepEqual(analysis.requiredActions, []);
});

test("required actions map conditional warnings deterministically", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-conditional-actions",
    {
      ...cleanEvidence,
      ci: { ...cleanEvidence.ci, status: "NOT_AVAILABLE", totalJobs: 0, passedJobs: 0 },
      tests: { ...cleanEvidence.tests, status: "NOT_AVAILABLE", total: 0, passed: 0, flaky: 0 },
      security: { ...cleanEvidence.security, status: "NOT_AVAILABLE" },
      changeRisk: { ...cleanEvidence.changeRisk, level: "HIGH", changedComponents: ["payments"] },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.decision, "CONDITIONAL_GO");
  assert.deepEqual(analysis.requiredActions.map((action) => action.code), [
    "VERIFY_CI_EVIDENCE",
    "VERIFY_TEST_EVIDENCE",
    "REVIEW_CHANGE_SURFACE",
    "REVIEW_CRITICAL_COMPONENT",
    "VERIFY_SECURITY_EVIDENCE",
  ]);
});

test("flaky tests map to INVESTIGATE_FLAKY_TESTS once", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-flaky-actions",
    { ...cleanEvidence, tests: { ...cleanEvidence.tests, status: "WARNING", flaky: 2 } },
    { evaluatedAt },
  );

  assert.deepEqual(analysis.requiredActions.map((action) => action.code), ["INVESTIGATE_FLAKY_TESTS"]);
});

test("NO_GO blockers map to blocker actions with stable ordering", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-blocker-actions",
    {
      ...cleanEvidence,
      ci: { ...cleanEvidence.ci, status: "FAIL", failedJobs: 1 },
      tests: { ...cleanEvidence.tests, status: "FAIL", failed: 1 },
      security: { ...cleanEvidence.security, status: "FAIL", critical: 1, high: 1 },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.decision, "NO_GO");
  assert.deepEqual(analysis.requiredActions.map((action) => action.code), [
    "FIX_CI",
    "FIX_TESTS",
    "FIX_CRITICAL_SECURITY",
    "FIX_SECURITY",
  ]);
});

test("duplicate blocker and warning inputs do not duplicate actions", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-dedupe-actions",
    {
      ...cleanEvidence,
      tests: { ...cleanEvidence.tests, status: "WARNING", flaky: 2 },
      security: { ...cleanEvidence.security, status: "WARNING", medium: 2 },
    },
    { evaluatedAt },
  );

  assert.deepEqual(analysis.requiredActions.map((action) => action.code), [
    "INVESTIGATE_FLAKY_TESTS",
    "REVIEW_SECURITY_FINDINGS",
  ]);
});

test("provider-equivalent normalized evidence produces equivalent required actions", () => {
  const github = evaluateReleaseEvidence("github:example/project:v1", { ...cleanEvidence, tests: { ...cleanEvidence.tests, status: "NOT_AVAILABLE" } }, { evaluatedAt });
  const gitlab = evaluateReleaseEvidence("gitlab:example/project:v1", { ...cleanEvidence, tests: { ...cleanEvidence.tests, status: "NOT_AVAILABLE" } }, { evaluatedAt });

  assert.deepEqual(github.requiredActions, gitlab.requiredActions);
});

test("evidence completeness is 4/4 when all surfaces are verified", () => {
  const analysis = evaluateReleaseEvidence("unit-complete", cleanEvidence, { evaluatedAt });

  assert.deepEqual(analysis.evidenceCompleteness, {
    verifiedSurfaces: 4,
    totalSurfaces: 4,
    percentage: 100,
    missingSurfaces: [],
  });
});

test("evidence completeness is 1/4 with deterministic missing evidence list", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-one-surface",
    {
      ...cleanEvidence,
      ci: { ...cleanEvidence.ci, status: "NOT_AVAILABLE", totalJobs: 0, passedJobs: 0 },
      tests: { ...cleanEvidence.tests, status: "NOT_AVAILABLE", total: 0, passed: 0 },
      security: { ...cleanEvidence.security, status: "NOT_AVAILABLE" },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.evidenceCompleteness.verifiedSurfaces, 1);
  assert.equal(analysis.evidenceCompleteness.percentage, 25);
  assert.deepEqual(analysis.evidenceCompleteness.missingSurfaces, ["CI", "TESTS", "SECURITY"]);
});

test("evidence completeness is 0/4 when every surface is unavailable", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-zero-surfaces",
    {
      ci: { ...cleanEvidence.ci, status: "NOT_AVAILABLE", totalJobs: 0, passedJobs: 0 },
      tests: { ...cleanEvidence.tests, status: "NOT_AVAILABLE", total: 0, passed: 0 },
      security: { ...cleanEvidence.security, status: "NOT_AVAILABLE" },
      changeRisk: {
        ...cleanEvidence.changeRisk,
        reasons: ["github public change evidence is unavailable for this release candidate."],
      },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.evidenceCompleteness.verifiedSurfaces, 0);
  assert.equal(analysis.evidenceCompleteness.percentage, 0);
  assert.deepEqual(analysis.evidenceCompleteness.missingSurfaces, ["CI", "TESTS", "SECURITY", "CHANGE_RISK"]);
});

test("freshness derives CURRENT STALE and UNKNOWN conservatively", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-freshness",
    {
      ...cleanEvidence,
      ci: { ...cleanEvidence.ci, provenance: { provider: "github", repository: "example/project", sourceType: "workflow", label: "CI", observedAt: "2026-08-30T12:00:00.000Z" } },
      tests: { ...cleanEvidence.tests, provenance: { provider: "github", repository: "example/project", sourceType: "workflow", label: "Tests", observedAt: "2026-08-01T12:00:00.000Z" } },
    },
    { evaluatedAt },
  );

  assert.equal(analysis.evidenceFreshness.CI.state, "CURRENT");
  assert.equal(analysis.evidenceFreshness.TESTS.state, "STALE");
  assert.equal(analysis.evidenceFreshness.SECURITY.state, "UNKNOWN");
  assert.equal(analysis.evidenceFreshness.CHANGE_RISK.state, "UNKNOWN");
});

test("deterministic risk reason codes and critical components are derived from change data", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-risk-fingerprint",
    {
      ...cleanEvidence,
      changeRisk: {
        ...cleanEvidence.changeRisk,
        level: "HIGH",
        filesChanged: 45,
        linesAdded: 1200,
        linesDeleted: 600,
        changedComponents: ["authentication", "payments", "release-orchestration", "web", "ci"],
        riskReasons: ["LARGE_CHANGE_SURFACE", "HIGH_FILE_COUNT", "HIGH_ADDITION_COUNT", "HIGH_DELETION_COUNT", "MULTIPLE_COMPONENTS_CHANGED", "CRITICAL_COMPONENT_CHANGED"],
        changedAreas: ["authentication", "payments", "release-orchestration", "web", "ci"],
        criticalComponents: ["authentication", "payments", "release-orchestration"],
      },
    },
    { evaluatedAt },
  );

  assert.deepEqual(analysis.riskFingerprint.riskReasons, ["LARGE_CHANGE_SURFACE", "HIGH_FILE_COUNT", "HIGH_ADDITION_COUNT", "HIGH_DELETION_COUNT", "MULTIPLE_COMPONENTS_CHANGED", "CRITICAL_COMPONENT_CHANGED"]);
  assert.deepEqual(analysis.riskFingerprint.criticalComponents, ["authentication", "payments", "release-orchestration"]);
});

test("decisionPath preserves required-action ordering and does not promise GO", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-decision-path",
    {
      ...cleanEvidence,
      ci: { ...cleanEvidence.ci, status: "NOT_AVAILABLE", totalJobs: 0, passedJobs: 0 },
      tests: { ...cleanEvidence.tests, status: "NOT_AVAILABLE", total: 0, passed: 0, flaky: 0 },
      security: { ...cleanEvidence.security, status: "NOT_AVAILABLE" },
      changeRisk: { ...cleanEvidence.changeRisk, level: "HIGH", changedComponents: ["payments"] },
    },
    { evaluatedAt },
  );

  assert.deepEqual(analysis.decisionPath.nextBestActions, analysis.requiredActions.map((action) => action.code));
  assert.deepEqual(analysis.decisionPath.nextBestActions, ["VERIFY_CI_EVIDENCE", "VERIFY_TEST_EVIDENCE", "REVIEW_CHANGE_SURFACE", "REVIEW_CRITICAL_COMPONENT", "VERIFY_SECURITY_EVIDENCE"]);
  assert.doesNotMatch(analysis.decisionPath.note, /will become GO/i);
  assert.match(analysis.decisionPath.note, /does not guarantee GO/i);
});

test("SECURITY_NOT_AVAILABLE uses unavailable-evidence wording", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-security-unavailable",
    { ...cleanEvidence, security: { ...cleanEvidence.security, status: "NOT_AVAILABLE" } },
    { evaluatedAt },
  );

  assert.ok(analysis.conditions.some((condition) => condition.includes("security evidence is unavailable")));
  assert.ok(!analysis.conditions.some((condition) => condition.includes("non-blocking security findings")));
});

test("real non-blocking security findings still use findings wording", () => {
  const analysis = evaluateReleaseEvidence(
    "unit-security-findings",
    { ...cleanEvidence, security: { ...cleanEvidence.security, status: "WARNING", medium: 1 } },
    { evaluatedAt },
  );

  assert.ok(analysis.conditions.some((condition) => condition.includes("non-blocking security findings")));
  assert.ok(analysis.requiredActions.some((action) => action.code === "REVIEW_SECURITY_FINDINGS"));
});
