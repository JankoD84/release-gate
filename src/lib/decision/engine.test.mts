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

test("clean evidence is GO", () => {
  const analysis = evaluateReleaseEvidence("unit-clean", cleanEvidence, {
    evaluatedAt,
  });

  assert.equal(analysis.decision, "GO");
  assert.equal(analysis.confidence, "HIGH");
  assert.deepEqual(analysis.blockingEvidence, []);
  assert.deepEqual(analysis.warnings, []);
  assert.deepEqual(analysis.conditions, []);
});
